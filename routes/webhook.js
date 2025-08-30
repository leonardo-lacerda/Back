const express = require('express');
const crypto = require('crypto');
const { getConnection } = require('../config/database');

const router = express.Router();

// Middleware para verificar assinatura do webhook (se configurado)
const verifyWebhookSignature = (req, res, next) => {
  if (!process.env.ASAAS_WEBHOOK_SECRET) {
    return next(); // Pular verificação se não houver secret configurado
  }

  const signature = req.headers['asaas-signature'];
  if (!signature) {
    return res.status(401).json({ error: 'Assinatura do webhook não encontrada' });
  }

  try {
    const payload = JSON.stringify(req.body);
    const expectedSignature = crypto
      .createHmac('sha256', process.env.ASAAS_WEBHOOK_SECRET)
      .update(payload)
      .digest('hex');

    if (signature !== expectedSignature) {
      return res.status(401).json({ error: 'Assinatura inválida' });
    }

    next();
  } catch (error) {
    console.error('Erro ao verificar assinatura do webhook:', error);
    res.status(500).json({ error: 'Erro ao verificar assinatura' });
  }
};

// Webhook do Asaas
router.post('/asaas', verifyWebhookSignature, async (req, res) => {
  try {
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
        await handlePaymentCreated(payment, connection);
        break;
      
      case 'PAYMENT_AWAITING_CONFIRMATION':
        await handlePaymentAwaitingConfirmation(payment, connection);
        break;
      
      case 'PAYMENT_CONFIRMED':
        await handlePaymentConfirmed(payment, connection);
        break;
      
      case 'PAYMENT_RECEIVED':
        await handlePaymentReceived(payment, connection);
        break;
      
      case 'PAYMENT_OVERDUE':
        await handlePaymentOverdue(payment, connection);
        break;
      
      case 'PAYMENT_DELETED':
        await handlePaymentDeleted(payment, connection);
        break;
      
      case 'PAYMENT_RESTORED':
        await handlePaymentRestored(payment, connection);
        break;
      
      case 'PAYMENT_REFUNDED':
        await handlePaymentRefunded(payment, connection);
        break;
      
      default:
        console.log(`Evento não tratado: ${event}`);
    }

    // Marcar webhook como processado
    await connection.execute(
      'UPDATE webhook_logs SET processed = TRUE WHERE payment_id = ? AND event_type = ? ORDER BY created_at DESC LIMIT 1',
      [payment?.id || null, event]
    );

    res.status(200).json({ success: true, message: 'Webhook processado' });

  } catch (error) {
    console.error('Erro ao processar webhook:', error);
    
    // Log do erro
    const connection = getConnection();
    await connection.execute(
      'UPDATE webhook_logs SET error_message = ? WHERE payment_id = ? ORDER BY created_at DESC LIMIT 1',
      [error.message, req.body.payment?.id || null]
    );

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
  console.log(`Pagamento recebido: ${payment.id}`);
  await updatePaymentStatus(payment.id, 'RECEIVED', connection, new Date());
  
  // Pagamento finalizado - ativar serviços
  await activateCustomerServices(payment, connection);
}

async function handlePaymentOverdue(payment, connection) {
  console.log(`Pagamento vencido: ${payment.id}`);
  await updatePaymentStatus(payment.id, 'OVERDUE', connection);
  
  // Aqui você pode adicionar lógica para:
  // - Enviar notificação de vencimento
  // - Suspender serviços
  // - Criar nova cobrança
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
    const query = `
      UPDATE payments 
      SET status = ?, payment_date = ?, updated_at = CURRENT_TIMESTAMP 
      WHERE asaas_payment_id = ?
    `;
    await connection.execute(query, [status, paymentDate, asaasPaymentId]);
  } catch (error) {
    console.error(`Erro ao atualizar status do pagamento ${asaasPaymentId}:`, error);
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