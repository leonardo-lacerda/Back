const mysql = require('mysql2/promise');
require('dotenv').config();

const dbConfig = {
  host: process.env.DB_HOST,
  port: process.env.DB_PORT || 3306,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
};

async function runMigrations() {
  let connection;
  
  try {
    console.log('🔄 Conectando ao banco de dados...');
    connection = await mysql.createConnection(dbConfig);
    console.log('✅ Conectado ao MySQL');

    // Criar tabela de clientes
    console.log('🔄 Criando tabela customers...');
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS customers (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        email VARCHAR(255) NOT NULL UNIQUE,
        cpf VARCHAR(14) NOT NULL UNIQUE,
        phone VARCHAR(20) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_email (email),
        INDEX idx_cpf (cpf)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // Criar tabela de pagamentos
    console.log('🔄 Criando tabela payments...');
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS payments (
        id INT AUTO_INCREMENT PRIMARY KEY,
        customer_id INT NOT NULL,
        asaas_payment_id VARCHAR(255) NOT NULL UNIQUE,
        asaas_customer_id VARCHAR(255) NOT NULL,
        plan_type ENUM('ESSENCIAL', 'COMPLETO') NOT NULL,
        amount DECIMAL(10,2) NOT NULL,
        payment_method ENUM('PIX', 'CREDIT_CARD') NOT NULL,
        status ENUM('PENDING', 'CONFIRMED', 'RECEIVED', 'OVERDUE', 'REFUNDED', 'CANCELLED') DEFAULT 'PENDING',
        invoice_url TEXT,
        pix_code TEXT,
        qr_code_url TEXT,
        due_date DATE,
        payment_date TIMESTAMP NULL,
        webhook_events JSON,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE,
        INDEX idx_asaas_payment_id (asaas_payment_id),
        INDEX idx_customer_id (customer_id),
        INDEX idx_status (status),
        INDEX idx_plan_type (plan_type),
        INDEX idx_created_at (created_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // Criar tabela de logs de webhook
    console.log('🔄 Criando tabela webhook_logs...');
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS webhook_logs (
        id INT AUTO_INCREMENT PRIMARY KEY,
        payment_id VARCHAR(255),
        event_type VARCHAR(100),
        payload JSON,
        processed BOOLEAN DEFAULT FALSE,
        error_message TEXT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_payment_id (payment_id),
        INDEX idx_event_type (event_type),
        INDEX idx_processed (processed),
        INDEX idx_created_at (created_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // Criar tabela de configurações (opcional)
    console.log('🔄 Criando tabela settings...');
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS settings (
        id INT AUTO_INCREMENT PRIMARY KEY,
        key_name VARCHAR(255) NOT NULL UNIQUE,
        value TEXT,
        description TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_key_name (key_name)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // Inserir configurações padrão
    console.log('🔄 Inserindo configurações padrão...');
    await connection.execute(`
      INSERT IGNORE INTO settings (key_name, value, description) VALUES 
      ('webhook_url', '${process.env.WEBHOOK_URL || ''}', 'URL do webhook para o Asaas'),
      ('frontend_url', '${process.env.FRONTEND_URL || ''}', 'URL do frontend'),
      ('email_notifications', 'true', 'Ativar notificações por email'),
      ('whatsapp_notifications', 'true', 'Ativar notificações por WhatsApp')
    `);

    // Criar views úteis
    console.log('🔄 Criando views...');
    await connection.execute(`
      CREATE OR REPLACE VIEW payment_summary AS
      SELECT 
        p.id,
        p.asaas_payment_id,
        c.name as customer_name,
        c.email as customer_email,
        c.cpf as customer_cpf,
        p.plan_type,
        p.amount,
        p.payment_method,
        p.status,
        p.due_date,
        p.payment_date,
        p.created_at,
        CASE 
          WHEN p.status = 'RECEIVED' THEN 'Pago'
          WHEN p.status = 'PENDING' THEN 'Pendente'
          WHEN p.status = 'OVERDUE' THEN 'Vencido'
          WHEN p.status = 'CANCELLED' THEN 'Cancelado'
          WHEN p.status = 'REFUNDED' THEN 'Estornado'
          ELSE p.status
        END as status_pt
      FROM payments p
      JOIN customers c ON p.customer_id = c.id
    `);

    console.log('✅ Todas as tabelas e views foram criadas com sucesso!');

    // Mostrar resumo
    const [tableStats] = await connection.execute(`
      SELECT 
        'customers' as tabela,
        COUNT(*) as registros
      FROM customers
      UNION ALL
      SELECT 
        'payments' as tabela,
        COUNT(*) as registros
      FROM payments
      UNION ALL
      SELECT 
        'webhook_logs' as tabela,
        COUNT(*) as registros
      FROM webhook_logs
    `);

    console.log('\n📊 Resumo do banco de dados:');
    tableStats.forEach(stat => {
      console.log(`  ${stat.tabela}: ${stat.registros} registros`);
    });

  } catch (error) {
    console.error('❌ Erro na migração:', error);
    process.exit(1);
  } finally {
    if (connection) {
      await connection.end();
      console.log('\n🔌 Conexão com o banco encerrada');
    }
  }
}

// Executar se chamado diretamente
if (require.main === module) {
  runMigrations()
    .then(() => {
      console.log('🎉 Migração concluída com sucesso!');
      process.exit(0);
    })
    .catch(error => {
      console.error('❌ Erro na migração:', error);
      process.exit(1);
    });
}

module.exports = { runMigrations };