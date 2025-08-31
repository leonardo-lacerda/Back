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

// Middleware para log de requisições de pagamento
const logPaymentRequest = (req, res, next) => {
  const timestamp = new Date().toISOString();
  const origin = req.get('origin') || 'sem origin';
  
  console.log(`💳 [${timestamp}] Requisição de pagamento:`);
  console.log(`   Origin: ${origin}`);
  console.log(`   Method: ${req.method}`);
  console.log(`   Body: ${JSON.stringify(req.body, null, 2)}`);
  
  next();
};

// Função principal para criar pagamento
const createPaymentHandler = async (req, res) => {
  const connection = getConnection();
  
  try {
    // Log inicial
    console.log('🚀 Iniciando criação de pagamento...');
    
    // Validar dados
    const { error, value } = paymentSchema.validate(req.body);
    if (error) {
      console.log('❌ Dados inválidos:', error.details);
      return res.status(400).json({
        error: 'Dados inválidos',
        details: error.details.map(detail => detail.message)
      });
    }

    const { nome, cpf, email, telefone, paymentMethod, planType, amount } = value;
    console.log(`✅ Dados validados para: ${nome} (${email})`);

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
      
      console.log(`👤 Cliente existente encontrado: ID ${customerId}`);
      
      // Atualizar dados do cliente se necessário
      await connection.execute(
        'UPDATE customers SET nome = ?, telefone = ?, updated_at = NOW() WHERE id = ?',
        [nome, telefone, customerId]
      );
    } else {
      console.log('👤 Criando novo cliente...');
      
      // Criar novo cliente no Asaas
      const asaasCustomer = await asaasService.createCustomer({
        name: nome,
        cpfCnpj: cpf,
        email: email,
        phone: telefone
      });

      if (!asaasCustomer.id) {
        console.error('❌ Erro ao criar cliente no Asaas:', asaasCustomer);
        throw new Error('Erro ao criar cliente no Asaas: ' + JSON.stringify(asaasCustomer));
      }

      asaasCustomerId = asaasCustomer.id;
      console.log(`✅ Cliente criado no Asaas: ${asaasCustomerId}`);

      // Salvar cliente no banco
      const [result] = await connection.execute(
        'INSERT INTO customers (nome, cpf, email, telefone, asaas_customer_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, NOW(), NOW())',
        [nome, cpf, email, telefone, asaasCustomerId]
      );

      customerId = result.insertId;
      console.log(`✅ Cliente salvo no banco: ID ${customerId}`);
    }

    // Criar cobrança no Asaas
    console.log('💰 Criando cobrança no Asaas...');
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

    console.log('📋 Dados da cobrança:', paymentData);

    const asaasPayment = await asaasService.createPayment(paymentData);

    if (!asaasPayment.id) {
      console.error('❌ Erro ao criar cobrança no Asaas:', asaasPayment);
      throw new Error('Erro ao criar cobrança no Asaas: ' + JSON.stringify(asaasPayment));
    }

    console.log(`✅ Cobrança criada no Asaas: ${asaasPayment.id}`);

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
    console.log(`✅ Pagamento salvo no banco: ID ${paymentId}`);

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
      console.log('📱 Dados PIX incluídos na resposta');
    }

    // Dados específicos para Cartão de Crédito
    if (paymentMethod === 'CREDIT_CARD') {
      responseData.creditCard = {
        invoiceUrl: asaasPayment.invoiceUrl,
        bankSlipUrl: asaasPayment.bankSlipUrl
      };
      console.log('💳 Dados do cartão incluídos na resposta');
    }

    console.log(`🎉 Pagamento criado com sucesso: ID ${paymentId}, Asaas ID: ${asaasPayment.id}, Método: ${paymentMethod}`);
    console.log(`📧 Enviando resposta para: ${req.get('origin')}`);

    // Definir headers de resposta explicitamente
    res.header('Content-Type', 'application/json');
    res.status(200).json(responseData);

  } catch (error) {
    console.error('❌ Erro ao criar pagamento:', error);
    console.error('Stack trace:', error.stack);
    
    // Log detalhado do erro no banco
    try {
      await connection.execute(
        'INSERT INTO payment_errors (error_message, request_data, created_at) VALUES (?, ?, NOW())',
        [error.message, JSON.stringify(req.body)]
      );
    } catch (logError) {
      console.error('❌ Erro ao salvar log de erro:', logError);
    }

    res.status(500).json({
      error: 'Erro interno do servidor',
      message: process.env.NODE_ENV === 'development' ? error.message : 'Erro ao processar pagamento',
      timestamp: new Date().toISOString()
    });
  }
};

// Rota principal para criar pagamento
router.post('/create-payment', logPaymentRequest, createPaymentHandler);

// Rota alias para compatibilidade (create-subscription)
router.post('/create-subscription', logPaymentRequest, createPaymentHandler);

// Buscar status do pagamento
router.get('/payment-status/:id', async (req, res) => {
  const connection = getConnection();
  
  try {
    const paymentId = req.params.id;
    console.log(`📊 Buscando status do pagamento: ${paymentId}`);

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
      console.log(`❌ Pagamento não encontrado: ${paymentId}`);
      return res.status(404).json({
        error: 'Pagamento não encontrado'
      });
    }

    const paymentData = payment[0];
    console.log(`✅ Pagamento encontrado: ${paymentData.asaas_payment_id}`);

    // Buscar status atualizado no Asaas
    const asaasPayment = await asaasService.getPayment(paymentData.asaas_payment_id);

    // Atualizar status no banco se mudou
    if (asaasPayment.status !== paymentData.status) {
      await connection.execute(
        'UPDATE payments SET status = ?, updated_at = NOW() WHERE id = ?',
        [asaasPayment.status, paymentId]
      );
      console.log(`🔄 Status atualizado: ${paymentData.status} → ${asaasPayment.status}`);
    }

    const responseData = {
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
    };

    res.json(responseData);

  } catch (error) {
    console.error('❌ Erro ao buscar status do pagamento:', error);
    res.status(500).json({
      error: 'Erro ao buscar status do pagamento',
      message: process.env.NODE_ENV === 'development' ? error.message : 'Erro interno',
      timestamp: new Date().toISOString()
    });
  }
});

// Listar pagamentos (com paginação)
router.get('/payments', async (req, res) => {
  const connection = getConnection();
  
  try {
    console.log('📋 Listando pagamentos...');
    
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

    console.log(`✅ ${payments.length} pagamentos encontrados (página ${page}/${totalPages})`);

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
      message: process.env.NODE_ENV === 'development' ? error.message : 'Erro interno',
      timestamp: new Date().toISOString()
    });
  }
});

// Rota de teste para verificar se a API está respondendo
router.get('/test', (req, res) => {
  console.log('🧪 Rota de teste acessada');
  res.json({
    message: 'API de pagamentos funcionando!',
    timestamp: new Date().toISOString(),
    origin: req.get('origin'),
    headers: req.headers
  });
});

module.exports = router;