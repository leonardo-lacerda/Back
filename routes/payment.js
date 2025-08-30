const express = require('express');
const Joi = require('joi');
const { getConnection } = require('../config/database');
const asaasService = require('../services/asaasService');
const router = express.Router();

// Schema de validação
const paymentSchema = Joi.object({
  nome: Joi.string().min(2).max(255).required().messages({
    'string.min': 'Nome deve ter pelo menos 2 caracteres',
    'string.max': 'Nome deve ter no máximo 255 caracteres',
    'any.required': 'Nome é obrigatório'
  }),
  cpf: Joi.string().pattern(/^\d{11}$/).required().messages({
    'string.pattern.base': 'CPF deve conter exatamente 11 dígitos',
    'any.required': 'CPF é obrigatório'
  }),
  email: Joi.string().email().max(255).required().messages({
    'string.email': 'Email deve ter um formato válido',
    'string.max': 'Email deve ter no máximo 255 caracteres',
    'any.required': 'Email é obrigatório'
  }),
  telefone: Joi.string().min(10).max(11).pattern(/^\d+$/).required().messages({
    'string.min': 'Telefone deve ter pelo menos 10 dígitos',
    'string.max': 'Telefone deve ter no máximo 11 dígitos',
    'string.pattern.base': 'Telefone deve conter apenas números',
    'any.required': 'Telefone é obrigatório'
  }),
  paymentMethod: Joi.string().valid('PIX', 'CREDIT_CARD').required().messages({
    'any.only': 'Método de pagamento deve ser PIX ou CREDIT_CARD',
    'any.required': 'Método de pagamento é obrigatório'
  }),
  planType: Joi.string().valid('ESSENCIAL', 'COMPLETO').required().messages({
    'any.only': 'Tipo do plano deve ser ESSENCIAL ou COMPLETO',
    'any.required': 'Tipo do plano é obrigatório'
  }),
  amount: Joi.number().positive().required().messages({
    'number.positive': 'Valor deve ser positivo',
    'any.required': 'Valor é obrigatório'
  })
});

// Criar pagamento
router.post('/create-payment', async (req, res) => {
  const connection = getConnection();
  
  try {
    // Validar dados
    const { error, value } = paymentSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        error: 'Dados inválidos',
        details: error.details.map(detail => detail.message)
      });
    }

    const { nome, cpf, email, telefone, paymentMethod, planType, amount } = value;

    // Verificar se cliente já existe
    let [existingCustomer] = await connection.execute(
      'SELECT id, asaas_customer_id FROM customers WHERE email = ? OR cpf = ?',
      [email, cpf]
    );

    let customerId;
    let asaasCustomerId;

    if (existingCustomer.length > 0) {
      // Cliente existe
      customerId = existingCustomer[0].id;
      asaasCustomerId = existingCustomer[0].asaas_customer_id;
      
      // Atualizar dados do cliente se necessário
      await connection.execute(
        'UPDATE customers SET nome = ?, telefone = ?, updated_at = NOW() WHERE id = ?',
        [nome, telefone, customerId]
      );
    } else {
      // Criar novo cliente no Asaas
      const asaasCustomer = await asaasService.createCustomer({
        name: nome,
        cpfCnpj: cpf,
        email: email,
        phone: telefone
      });

      if (!asaasCustomer.id) {
        throw new Error('Erro ao criar cliente no Asaas: ' + JSON.stringify(asaasCustomer));
      }

      asaasCustomerId = asaasCustomer.id;

      // Salvar cliente no banco
      const [result] = await connection.execute(
        'INSERT INTO customers (nome, cpf, email, telefone, asaas_customer_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, NOW(), NOW())',
        [nome, cpf, email, telefone, asaasCustomerId]
      );

      customerId = result.insertId;
    }

    // Criar cobrança no Asaas
    const billingType = paymentMethod === 'PIX' ? 'PIX' : 'CREDIT_CARD';
    
    const paymentData = {
      customer: asaasCustomerId,
      billingType: billingType,
      value: amount,
      dueDate: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().split('T')[0], // 1 dia
      description: `Plano ${planType} - Sistema de Gestão`,
      externalReference: `${planType}_${Date.now()}`,
      installmentCount: paymentMethod === 'CREDIT_CARD' ? 1 : undefined,
      installmentValue: paymentMethod === 'CREDIT_CARD' ? amount : undefined
    };

    const asaasPayment = await asaasService.createPayment(paymentData);

    if (!asaasPayment.id) {
      throw new Error('Erro ao criar cobrança no Asaas: ' + JSON.stringify(asaasPayment));
    }

    // Salvar pagamento no banco
    const [paymentResult] = await connection.execute(
      `INSERT INTO payments (
        customer_id, 
        asaas_payment_id, 
        plan_type, 
        payment_method, 
        amount, 
        status, 
        external_reference,
        created_at, 
        updated_at
      ) VALUES (?, ?, ?, ?, ?, 'PENDING', ?, NOW(), NOW())`,
      [
        customerId,
        asaasPayment.id,
        planType,
        paymentMethod,
        amount,
        paymentData.externalReference
      ]
    );

    const paymentId = paymentResult.insertId;

    // Preparar resposta com dados específicos por método
    let responseData = {
      success: true,
      paymentId: paymentId,
      asaasPaymentId: asaasPayment.id,
      status: asaasPayment.status,
      value: asaasPayment.value,
      dueDate: asaasPayment.dueDate,
      invoiceUrl: asaasPayment.invoiceUrl
    };

    // Dados específicos para PIX
    if (paymentMethod === 'PIX' && asaasPayment.pixTransaction) {
      responseData.pix = {
        qrCode: asaasPayment.pixTransaction.qrCode?.payload,
        qrCodeImage: asaasPayment.pixTransaction.qrCode?.encodedImage,
        expirationDate: asaasPayment.pixTransaction.expirationDate
      };
    }

    // Dados específicos para Cartão de Crédito
    if (paymentMethod === 'CREDIT_CARD') {
      responseData.creditCard = {
        invoiceUrl: asaasPayment.invoiceUrl,
        bankSlipUrl: asaasPayment.bankSlipUrl
      };
    }

    console.log(`✅ Pagamento criado: ID ${paymentId}, Asaas ID: ${asaasPayment.id}, Método: ${paymentMethod}`);

    res.json(responseData);

  } catch (error) {
    console.error('❌ Erro ao criar pagamento:', error);
    
    // Log detalhado do erro no banco
    try {
      await connection.execute(
        'INSERT INTO payment_errors (error_message, request_data, created_at) VALUES (?, ?, NOW())',
        [error.message, JSON.stringify(req.body)]
      );
    } catch (logError) {
      console.error('Erro ao salvar log de erro:', logError);
    }

    res.status(500).json({
      error: 'Erro interno do servidor',
      message: process.env.NODE_ENV === 'development' ? error.message : 'Erro ao processar pagamento'
    });
  }
});

// Buscar status do pagamento
router.get('/payment-status/:id', async (req, res) => {
  const connection = getConnection();
  
  try {
    const paymentId = req.params.id;

    // Buscar pagamento no banco
    const [payment] = await connection.execute(
      `SELECT 
        p.*, 
        c.nome, 
        c.email, 
        c.cpf 
      FROM payments p 
      JOIN customers c ON p.customer_id = c.id 
      WHERE p.id = ?`,
      [paymentId]
    );

    if (payment.length === 0) {
      return res.status(404).json({
        error: 'Pagamento não encontrado'
      });
    }

    const paymentData = payment[0];

    // Buscar status atualizado no Asaas
    const asaasPayment = await asaasService.getPayment(paymentData.asaas_payment_id);

    // Atualizar status no banco se mudou
    if (asaasPayment.status !== paymentData.status) {
      await connection.execute(
        'UPDATE payments SET status = ?, updated_at = NOW() WHERE id = ?',
        [asaasPayment.status, paymentId]
      );
    }

    res.json({
      id: paymentData.id,
      asaasPaymentId: paymentData.asaas_payment_id,
      status: asaasPayment.status,
      value: asaasPayment.value,
      paymentMethod: paymentData.payment_method,
      planType: paymentData.plan_type,
      customer: {
        nome: paymentData.nome,
        email: paymentData.email,
        cpf: paymentData.cpf
      },
      createdAt: paymentData.created_at,
      updatedAt: paymentData.updated_at,
      invoiceUrl: asaasPayment.invoiceUrl,
      // Dados PIX se disponível
      ...(asaasPayment.pixTransaction && {
        pix: {
          qrCode: asaasPayment.pixTransaction.qrCode?.payload,
          qrCodeImage: asaasPayment.pixTransaction.qrCode?.encodedImage,
          expirationDate: asaasPayment.pixTransaction.expirationDate
        }
      })
    });

  } catch (error) {
    console.error('❌ Erro ao buscar status do pagamento:', error);
    res.status(500).json({
      error: 'Erro ao buscar status do pagamento',
      message: process.env.NODE_ENV === 'development' ? error.message : 'Erro interno'
    });
  }
});

// Listar pagamentos (com paginação)
router.get('/payments', async (req, res) => {
  const connection = getConnection();
  
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;
    const status = req.query.status;

    let whereClause = '';
    let params = [];

    if (status) {
      whereClause = 'WHERE p.status = ?';
      params.push(status);
    }

    // Buscar pagamentos
    const [payments] = await connection.execute(
      `SELECT 
        p.*,
        c.nome,
        c.email,
        c.cpf
      FROM payments p
      JOIN customers c ON p.customer_id = c.id
      ${whereClause}
      ORDER BY p.created_at DESC
      LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    // Contar total
    const [countResult] = await connection.execute(
      `SELECT COUNT(*) as total FROM payments p ${whereClause}`,
      params
    );

    const total = countResult[0].total;
    const totalPages = Math.ceil(total / limit);

    res.json({
      payments,
      pagination: {
        page,
        limit,
        total,
        totalPages,
        hasNext: page < totalPages,
        hasPrev: page > 1
      }
    });

  } catch (error) {
    console.error('❌ Erro ao listar pagamentos:', error);
    res.status(500).json({
      error: 'Erro ao listar pagamentos',
      message: process.env.NODE_ENV === 'development' ? error.message : 'Erro interno'
    });
  }
});

module.exports = router;