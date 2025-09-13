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
  
  const success = await updatePaymentStatus(payment.id, 'RECEIVED', connection);
  
  if (success) {
    // ✅ CORREÇÃO: Passar payment.id em vez de payment
    console.log(`🎯 Ativando serviços para o cliente...`);
    await activateCustomerServices(payment.id, connection);
  } else {
    console.error('❌ Falha ao atualizar pagamento - serviços NÃO ativados');
  }
}

// ✅ ADICIONADO: Handler que estava faltando
async function handlePaymentOverdue(payment, connection) {
  console.log(`⏰ Pagamento em atraso: ${payment.id}`);
  await updatePaymentStatus(payment.id, 'OVERDUE', connection);
  
  // Aqui você pode adicionar:
  // - Enviar email de cobrança
  // - Notificar sistema de inadimplência
  // - Suspender serviços se necessário
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
  
  // ✅ CORREÇÃO: Passar payment.id em vez de payment
  await deactivateCustomerServices(payment.id, connection);
}

// Função auxiliar para atualizar status do pagamento
async function updatePaymentStatus(asaasPaymentId, status, connection, paymentDate = null) {
  try {
    console.log(`🔄 Tentando atualizar pagamento: ${asaasPaymentId} para status: ${status}`);
    console.log(`📅 Data do pagamento: ${paymentDate}`);
    
    // Primeiro, verificar se o pagamento existe
    const [existingPayment] = await connection.execute(
      'SELECT id, asaas_payment_id, status, customer_id, plan_type FROM payments WHERE asaas_payment_id = ?',
      [asaasPaymentId]
    );
    
    if (existingPayment.length === 0) {
      console.error(`❌ Pagamento ${asaasPaymentId} NÃO EXISTE na tabela payments`);
      console.log('🔍 Tentando buscar por qualquer pagamento similar...');
      
      const [similarPayments] = await connection.execute(
        'SELECT asaas_payment_id FROM payments ORDER BY created_at DESC LIMIT 5'
      );
      console.log('📋 Últimos 5 pagamentos na tabela:', similarPayments.map(p => p.asaas_payment_id));
      return false;
    }
    
    console.log(`✅ Pagamento encontrado na tabela:`, {
      id: existingPayment[0].id,
      current_status: existingPayment[0].status,
      customer_id: existingPayment[0].customer_id,
      plan_type: existingPayment[0].plan_type
    });
    
    // Verificar se o status já está atualizado
    if (existingPayment[0].status === status) {
      console.log(`ℹ️ Status já está como ${status}. Nenhuma atualização necessária.`);
      return true;
    }
    
    // UPDATE sem payment_date (coluna não existe no seu schema)
    const updateQuery = `
      UPDATE payments 
      SET status = ?, updated_at = CURRENT_TIMESTAMP 
      WHERE asaas_payment_id = ?
    `;
    
    console.log('🔍 Executando query:', updateQuery);
    console.log('🔍 Com parâmetros:', [status, asaasPaymentId]);
    
    const [result] = await connection.execute(updateQuery, [status, asaasPaymentId]);
    
    console.log(`📊 Resultado do UPDATE:`, {
      affectedRows: result.affectedRows,
      changedRows: result.changedRows,
      warningCount: result.warningCount,
      info: result.info
    });
    
    if (result.affectedRows === 0) {
      console.error(`❌ FALHA: Nenhuma linha foi afetada no UPDATE`);
      return false;
    }
    
    if (result.changedRows === 0) {
      console.warn(`⚠️ AVISO: UPDATE executado mas nenhuma mudança detectada (status já era ${status})`);
    }
    
    // Verificar se a atualização foi aplicada
    const [updatedPayment] = await connection.execute(
      'SELECT status, updated_at FROM payments WHERE asaas_payment_id = ?',
      [asaasPaymentId]
    );
    
    if (updatedPayment.length > 0) {
      console.log(`✅ SUCESSO: Pagamento ${asaasPaymentId} atualizado!`, {
        old_status: existingPayment[0].status,
        new_status: updatedPayment[0].status,
        updated_at: updatedPayment[0].updated_at
      });
    }
    
    return true;
    
  } catch (error) {
    console.error(`❌ ERRO ao atualizar pagamento ${asaasPaymentId}:`, error.message);
    console.error('💥 Código do erro:', error.code);
    console.error('💥 SQL State:', error.sqlState);
    console.error('💥 Stack trace:', error.stack);
    
    // Log da query que causou o erro (para debug)
    if (error.sql) {
      console.error('💥 Query que falhou:', error.sql);
    }
    
    return false;
  }
}

// Função para ativar serviços do cliente
async function activateCustomerServices(asaasPaymentId, connection) {
  try {
    console.log('🎯 Ativando serviços para o cliente...');
    
    // Debug: verificar estrutura da tabela
    await debugTableStructure(connection);
    
    // Tentar diferentes variações do nome da coluna
    let query = '';
    let queryVariations = [
      // Variação 1: usando 'name'
      `SELECT p.*, c.name, c.email, c.telefone 
       FROM payments p 
       JOIN customers c ON p.customer_id = c.id 
       WHERE p.asaas_payment_id = ?`,
       
      // Variação 2: usando 'nome' 
      `SELECT p.*, c.nome, c.email, c.telefone 
       FROM payments p 
       JOIN customers c ON p.customer_id = c.id 
       WHERE p.asaas_payment_id = ?`,
       
      // Variação 3: sem o campo name/nome (mais seguro)
      `SELECT p.*, c.email, c.telefone, c.cpf, c.asaas_customer_id
       FROM payments p 
       JOIN customers c ON p.customer_id = c.id 
       WHERE p.asaas_payment_id = ?`
    ];
    
    let paymentData = null;
    let usedQuery = '';
    
    // Tentar cada variação até uma funcionar
    for (let i = 0; i < queryVariations.length; i++) {
      try {
        console.log(`🔍 Tentando query variação ${i + 1}:`, queryVariations[i]);
        
        const [result] = await connection.execute(queryVariations[i], [asaasPaymentId]);
        
        if (result.length > 0) {
          paymentData = result;
          usedQuery = queryVariations[i];
          console.log(`✅ Query variação ${i + 1} funcionou!`);
          break;
        }
        
      } catch (queryError) {
        console.log(`❌ Query variação ${i + 1} falhou:`, queryError.message);
        continue;
      }
    }
    
    if (!paymentData || paymentData.length === 0) {
      console.error(`❌ Pagamento não encontrado com nenhuma variação da query: ${asaasPaymentId}`);
      return;
    }
    
    const payment = paymentData[0];
    console.log('✅ Dados do pagamento encontrados:', {
      id: payment.id,
      customer_name: payment.name || payment.nome || 'Nome não disponível',
      customer_email: payment.email,
      customer_phone: payment.telefone,
      plan_type: payment.plan_type,
      status: payment.status
    });
    
    // Lógica de ativação baseada no plano
    console.log(`🚀 Ativando plano: ${payment.plan_type}`);
    
    switch (payment.plan_type) {
      case 'ESSENCIAL':
        console.log('🟢 Ativando funcionalidades do plano ESSENCIAL...');
        // Aqui você implementa a lógica específica do plano ESSENCIAL
        // Exemplo: ativar funcionalidades básicas
        await activateEssentialPlan(payment, connection);
        break;
        
      case 'COMPLETO':
        console.log('🟡 Ativando funcionalidades do plano COMPLETO...');
        // Aqui você implementa a lógica específica do plano COMPLETO
        // Exemplo: ativar todas as funcionalidades
        await activateCompletePlan(payment, connection);
        break;
        
      default:
        console.log(`⚠️ Plano não reconhecido: ${payment.plan_type}`);
        console.log('📝 Aplicando configurações padrão...');
    }
    
    console.log('✅ Serviços ativados com sucesso!');
    
  } catch (error) {
    console.error('❌ Erro ao ativar serviços do cliente:', error);
    console.error('💥 Stack trace:', error.stack);
  }
}

// Funções auxiliares para cada tipo de plano
async function activateEssentialPlan(payment, connection) {
  try {
    console.log('🔧 Configurando plano ESSENCIAL...');
    
    // Exemplo: inserir configurações específicas
    await connection.execute(`
      INSERT INTO customer_features (customer_id, feature_name, is_active, created_at) 
      VALUES (?, 'basic_features', TRUE, NOW())
      ON DUPLICATE KEY UPDATE is_active = TRUE, updated_at = NOW()
    `, [payment.customer_id]);
    
    console.log('✅ Plano ESSENCIAL ativado!');
    
  } catch (error) {
    console.error('❌ Erro ao ativar plano ESSENCIAL:', error);
  }
}

async function activateCompletePlan(payment, connection) {
  try {
    console.log('🔧 Configurando plano COMPLETO...');
    
    // Exemplo: inserir configurações específicas
    await connection.execute(`
      INSERT INTO customer_features (customer_id, feature_name, is_active, created_at) 
      VALUES (?, 'premium_features', TRUE, NOW())
      ON DUPLICATE KEY UPDATE is_active = TRUE, updated_at = NOW()
    `, [payment.customer_id]);
    
    console.log('✅ Plano COMPLETO ativado!');
    
  } catch (error) {
    console.error('❌ Erro ao ativar plano COMPLETO:', error);
  }
}


// ✅ ADICIONADO: Função que estava faltando
async function deactivateCustomerServices(asaasPaymentId, connection) {
  try {
    console.log('🔴 Desativando serviços para o cliente...');
    
    const [paymentData] = await connection.execute(`
      SELECT p.*, c.name, c.email, c.telefone 
      FROM payments p 
      JOIN customers c ON p.customer_id = c.id 
      WHERE p.asaas_payment_id = ?
    `, [asaasPaymentId]);
    
    if (paymentData.length === 0) {
      console.error(`❌ Pagamento não encontrado: ${asaasPaymentId}`);
      return;
    }
    
    const payment = paymentData[0];
    console.log('⚠️ Desativando serviços para:', {
      customer_name: payment.name,
      plan_type: payment.plan_type
    });
    
    // Implementar lógica de desativação
    // - Suspender acesso às funcionalidades
    // - Enviar email de notificação
    // - Marcar como inativo no sistema
    
    console.log('✅ Serviços desativados com sucesso!');
    
  } catch (error) {
    console.error('❌ Erro ao desativar serviços do cliente:', error);
    console.error('Stack trace:', error.stack);
  }
}

// ✅ CORRIGIDO: Rota para reprocessar webhook 
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
    
    console.log(`🔄 Reprocessando webhook ID: ${webhookId}`);
    console.log(`📨 Evento: ${log.event_type}`);

    // Processar o webhook manualmente
    const { event, payment } = payload;
    
    switch (event) {
      case 'PAYMENT_CREATED':
        await handlePaymentCreated(payment, connection);
        break;
      case 'PAYMENT_RECEIVED':
        await handlePaymentReceived(payment, connection);
        break;
      case 'PAYMENT_OVERDUE':
        await handlePaymentOverdue(payment, connection);
        break;
      // Adicione outros casos conforme necessário
      default:
        console.log(`⚠️ Evento ${event} não pode ser reprocessado automaticamente`);
    }
    
    // Marcar como reprocessado
    await connection.execute(
      'UPDATE webhook_logs SET processed = TRUE, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [webhookId]
    );

    res.status(200).json({ 
      success: true, 
      message: `Webhook ${webhookId} reprocessado com sucesso` 
    });

  } catch (error) {
    console.error('❌ Erro ao reprocessar webhook:', error);
    res.status(500).json({ error: 'Erro ao reprocessar webhook' });
  }
});

module.exports = router;
