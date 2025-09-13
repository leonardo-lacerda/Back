const express = require('express');
const crypto = require('crypto');
const { getConnection } = require('../config/database');

const router = express.Router();

// Middleware para verificar assinatura do webhook (se configurado)
const verifyWebhookSignature = (req, res, next) => {
  // Verificação mais rigorosa
  const webhookSecret = process.env.ASAAS_WEBHOOK_SECRET;
  
  if (!webhookSecret || webhookSecret === '' || webhookSecret === 'your_webhook_secret_here') {
    console.log('🔓 Verificação de assinatura desabilitada');
    return next(); // Pular verificação
  }

  console.log('🔒 Verificando assinatura do webhook...');
  
  const signature = req.headers['asaas-signature'];
  if (!signature) {
    console.log('❌ Header asaas-signature não encontrado');
    return res.status(401).json({ error: 'Assinatura do webhook não encontrada' });
  }

  try {
    const payload = JSON.stringify(req.body);
    const expectedSignature = crypto
      .createHmac('sha256', webhookSecret)
      .update(payload)
      .digest('hex');

    if (signature !== expectedSignature) {
      console.log('❌ Assinatura inválida');
      return res.status(401).json({ error: 'Assinatura inválida' });
    }

    console.log('✅ Assinatura verificada com sucesso');
    next();
  } catch (error) {
    console.error('Erro ao verificar assinatura do webhook:', error);
    res.status(500).json({ error: 'Erro ao verificar assinatura' });
  }
};

// Webhook do Asaas
router.post('/asaas', verifyWebhookSignature, async (req, res) => {
  try {
    console.log('🎯 ===== WEBHOOK RECEBIDO =====');
    console.log('📨 Evento:', req.body.event);
    console.log('💳 Payment ID:', req.body.payment?.id);
    console.log('📊 Status do pagamento:', req.body.payment?.status);
    console.log('💰 Valor:', req.body.payment?.value);
    console.log('🎯 =============================');

    const { event, payment } = req.body;
    const connection = getConnection();

    // Log do webhook
    await connection.execute(
      'INSERT INTO webhook_logs (payment_id, event_type, payload) VALUES (?, ?, ?)',
      [payment?.id || null, event, JSON.stringify(req.body)]
    );

    // Processar diferentes tipos de eventos
    switch (event) {
      case 'PAYMENT_CREATED':
        console.log('🔄 Processando: PAYMENT_CREATED');
        await handlePaymentCreated(payment, connection);
        break;
      
      case 'PAYMENT_AWAITING_CONFIRMATION':
        console.log('🔄 Processando: PAYMENT_AWAITING_CONFIRMATION');
        await handlePaymentAwaitingConfirmation(payment, connection);
        break;
      
      case 'PAYMENT_CONFIRMED':
        console.log('🔄 Processando: PAYMENT_CONFIRMED');
        await handlePaymentConfirmed(payment, connection);
        break;
      
      case 'PAYMENT_RECEIVED':
        console.log('🔄 Processando: PAYMENT_RECEIVED');
        await handlePaymentReceived(payment, connection);
        break;
      
      case 'PAYMENT_OVERDUE':
        console.log('🔄 Processando: PAYMENT_OVERDUE');
        await handlePaymentOverdue(payment, connection);
        break;
      
      case 'PAYMENT_DELETED':
        console.log('🔄 Processando: PAYMENT_DELETED');
        await handlePaymentDeleted(payment, connection);
        break;
      
      case 'PAYMENT_RESTORED':
        console.log('🔄 Processando: PAYMENT_RESTORED');
        await handlePaymentRestored(payment, connection);
        break;
      
      case 'PAYMENT_REFUNDED':
        console.log('🔄 Processando: PAYMENT_REFUNDED');
        await handlePaymentRefunded(payment, connection);
        break;
      
      default:
        console.log(`⚠️ Evento não tratado: ${event}`);
    }

    // Marcar webhook como processado
    await connection.execute(
      'UPDATE webhook_logs SET processed = TRUE WHERE payment_id = ? AND event_type = ? ORDER BY created_at DESC LIMIT 1',
      [payment?.id || null, event]
    );

    console.log('✅ Webhook processado com sucesso!');
    res.status(200).json({ success: true, message: 'Webhook processado' });

  } catch (error) {
    console.error('❌ ERRO CRÍTICO no webhook:', error);
    console.error('Stack trace:', error.stack);
    
    // Log do erro
    try {
      const connection = getConnection();
      await connection.execute(
        'UPDATE webhook_logs SET error_message = ? WHERE payment_id = ? ORDER BY created_at DESC LIMIT 1',
        [error.message, req.body.payment?.id || null]
      );
    } catch (logError) {
      console.error('❌ Erro ao salvar log de erro:', logError);
    }

    res.status(500).json({ error: 'Erro ao processar webhook' });
  }
});


// Handlers para diferentes eventos
async function handlePaymentCreated(payment, connection) {
  console.log(`Pagamento criado: ${payment.id}`);
  // Atualizar status se necessário
  await updatePaymentStatus(payment.id, 'PENDING', connection);
}

async function handlePaymentAwaitingConfirmation(payment, connection) {
  console.log(`Pagamento aguardando confirmação: ${payment.id}`);
  await updatePaymentStatus(payment.id, 'PENDING', connection);
}

async function handlePaymentConfirmed(payment, connection) {
  console.log(`Pagamento confirmado: ${payment.id}`);
  await updatePaymentStatus(payment.id, 'CONFIRMED', connection);
  
  // Aqui você pode adicionar lógica para:
  // - Enviar email de confirmação
  // - Ativar serviço para o cliente
  // - Notificar sistemas internos
}

async function handlePaymentReceived(payment, connection) {
  console.log(`💰 === PROCESSANDO PAGAMENTO RECEBIDO ===`);
  console.log(`💳 ID: ${payment.id}`);
  console.log(`📊 Status: ${payment.status}`);
  console.log(`💵 Valor: R$ ${payment.value}`);
  console.log(`📅 Data do pagamento: ${payment.paymentDate}`);
  console.log(`💰 =======================================`);
  
  const paymentDate = payment.paymentDate ? new Date(payment.paymentDate) : new Date();
  
  await updatePaymentStatus(payment.id, 'RECEIVED', connection, paymentDate);
  
  // Pagamento finalizado - ativar serviços
  console.log(`🎯 Ativando serviços para o cliente...`);
  await activateCustomerServices(payment, connection);
}

async function handlePaymentDeleted(payment, connection) {
  console.log(`Pagamento cancelado: ${payment.id}`);
  await updatePaymentStatus(payment.id, 'CANCELLED', connection);
}

async function handlePaymentRestored(payment, connection) {
  console.log(`Pagamento restaurado: ${payment.id}`);
  await updatePaymentStatus(payment.id, 'PENDING', connection);
}

async function handlePaymentRefunded(payment, connection) {
  console.log(`Pagamento estornado: ${payment.id}`);
  await updatePaymentStatus(payment.id, 'REFUNDED', connection);
  
  // Desativar serviços se necessário
  await deactivateCustomerServices(payment, connection);
}

// Função auxiliar para atualizar status do pagamento
async function updatePaymentStatus(asaasPaymentId, status, connection, paymentDate = null) {
  try {
    console.log(`🔄 Tentando atualizar pagamento: ${asaasPaymentId} para status: ${status}`);
    console.log(`📅 Data do pagamento: ${paymentDate}`);
    
    const query = `
      UPDATE payments 
      SET status = ?, payment_date = ?, updated_at = CURRENT_TIMESTAMP 
      WHERE asaas_payment_id = ?
    `;
    
    const [result] = await connection.execute(query, [status, paymentDate, asaasPaymentId]);
    
    console.log(`📊 Resultado do UPDATE:`, {
      affectedRows: result.affectedRows,
      changedRows: result.changedRows,
      warningCount: result.warningCount
    });
    
    if (result.affectedRows === 0) {
      console.warn(`⚠️ NENHUM registro encontrado para asaas_payment_id: ${asaasPaymentId}`);
      
      // Verificar se o pagamento existe na tabela
      const [existingPayment] = await connection.execute(
        'SELECT id, asaas_payment_id, status FROM payments WHERE asaas_payment_id = ?',
        [asaasPaymentId]
      );
      
      if (existingPayment.length === 0) {
        console.error(`❌ Pagamento ${asaasPaymentId} NÃO EXISTE na tabela payments`);
      } else {
        console.log(`✅ Pagamento encontrado na tabela:`, existingPayment[0]);
      }
    } else {
      console.log(`✅ Pagamento ${asaasPaymentId} atualizado com sucesso para ${status}`);
    }
    
  } catch (error) {
    console.error(`❌ ERRO ao atualizar pagamento ${asaasPaymentId}:`, error);
    console.error('Stack trace:', error.stack);
  }
}


// Função para ativar serviços do cliente
async function activateCustomerServices(payment, connection) {
  try {
    // Buscar dados do cliente e pagamento
    const [paymentData] = await connection.execute(
      `SELECT p.*, c.name, c.email, c.phone 
       FROM payments p 
       JOIN customers c ON p.customer_id = c.id 
       WHERE p.asaas_payment_id = ?`,
      [payment.id]
    );

    if (paymentData.length === 0) {
      console.error(`Pagamento não encontrado: ${payment.id}`);
      return;
    }

    const customer = paymentData[0];
    
    // Aqui você implementará a lógica específica do seu negócio:
    // - Criar conta do cliente no sistema de automação
    // - Enviar dados para o sistema de CRM
    // - Configurar WhatsApp Business
    // - Enviar email de boas-vindas
    // - Etc.

    console.log(`Serviços ativados para o cliente: ${customer.name} (${customer.email})`);
    console.log(`Plano: ${customer.plan_type} - Valor: R$ ${customer.amount}`);

    // Exemplo de integração futura:
    // await integrateWithWhatsAppSystem(customer);
    // await sendWelcomeEmail(customer);
    
  } catch (error) {
    console.error('Erro ao ativar serviços do cliente:', error);
  }
}

// Função para desativar serviços do cliente
async function deactivateCustomerServices(payment, connection) {
  try {
    const [paymentData] = await connection.execute(
      `SELECT p.*, c.name, c.email 
       FROM payments p 
       JOIN customers c ON p.customer_id = c.id 
       WHERE p.asaas_payment_id = ?`,
      [payment.id]
    );

    if (paymentData.length > 0) {
      const customer = paymentData[0];
      console.log(`Serviços desativados para o cliente: ${customer.name}`);
      
      // Implementar lógica de desativação:
      // - Suspender automações
      // - Desativar acessos
      // - Enviar notificação
    }
    
  } catch (error) {
    console.error('Erro ao desativar serviços do cliente:', error);
  }
}

// Rota para reprocessar webhook (útil para debugging)
router.post('/reprocess/:webhookId', async (req, res) => {
  try {
    const { webhookId } = req.params;
    const connection = getConnection();

    const [webhookLog] = await connection.execute(
      'SELECT * FROM webhook_logs WHERE id = ?',
      [webhookId]
    );

    if (webhookLog.length === 0) {
      return res.status(404).json({ error: 'Webhook não encontrado' });
    }

    const log = webhookLog[0];
    const payload = JSON.parse(log.payload);

    // Reprocessar o webhook
    req.body = payload;
    await router.stack[0].handle(req, res);

  } catch (error) {
    console.error('Erro ao reprocessar webhook:', error);
    res.status(500).json({ error: 'Erro ao reprocessar webhook' });
  }
});

module.exports = router;