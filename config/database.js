const mysql = require('mysql2/promise');

let connection = null;

const dbConfig = {
  host: process.env.DB_HOST,
  port: process.env.DB_PORT || 3306,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  // Remover essas opções que causam warning
  // acquireTimeout: 60000,
  // timeout: 60000,
  // reconnect: true
};

const connectDB = async () => {
  try {
    connection = mysql.createPool(dbConfig);
    console.log('✅ Conectado ao MySQL');
    
    // Criar tabelas se não existirem
    await createTables();
    
  } catch (error) {
    console.error('❌ Erro ao conectar com MySQL:', error);
    process.exit(1);
  }
};

const createTables = async () => {
  try {
    // Tabela de clientes - CORRIGIDA para alinhar com o código
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS customers (
        id INT AUTO_INCREMENT PRIMARY KEY,
        nome VARCHAR(255) NOT NULL,
        cpf VARCHAR(11) NOT NULL UNIQUE,
        email VARCHAR(255) NOT NULL UNIQUE,
        telefone VARCHAR(15) NOT NULL,
        asaas_customer_id VARCHAR(100) UNIQUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_email (email),
        INDEX idx_cpf (cpf),
        INDEX idx_asaas_customer_id (asaas_customer_id)
      )
    `);

    // Tabela de pagamentos - CORRIGIDA
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS payments (
        id INT AUTO_INCREMENT PRIMARY KEY,
        customer_id INT NOT NULL,
        asaas_payment_id VARCHAR(255) NOT NULL UNIQUE,
        plan_type ENUM('ESSENCIAL', 'COMPLETO') NOT NULL,
        payment_method ENUM('PIX', 'CREDIT_CARD') NOT NULL,
        amount DECIMAL(10,2) NOT NULL,
        status ENUM('PENDING', 'CONFIRMED', 'RECEIVED', 'OVERDUE', 'REFUNDED', 'CANCELLED') DEFAULT 'PENDING',
        external_reference VARCHAR(255),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (customer_id) REFERENCES customers(id),
        INDEX idx_asaas_payment_id (asaas_payment_id),
        INDEX idx_customer_id (customer_id),
        INDEX idx_status (status)
      )
    `);

    // Tabela de erros de pagamento
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS payment_errors (
        id INT AUTO_INCREMENT PRIMARY KEY,
        error_message TEXT NOT NULL,
        error_stack TEXT,
        request_data JSON,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_created_at (created_at)
      )
    `);

    // Tabela de logs de webhook
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
        INDEX idx_event_type (event_type)
      )
    `);

    console.log('✅ Tabelas criadas/verificadas com sucesso');
  } catch (error) {
    console.error('❌ Erro ao criar tabelas:', error);
    throw error;
  }
};

const getConnection = () => {
  if (!connection) {
    throw new Error('Banco de dados não conectado');
  }
  return connection;
};

const testConnection = async () => {
  try {
    await connection.execute('SELECT 1');
    return true;
  } catch (error) {
    throw new Error('Erro de conexão com o banco');
  }
};

module.exports = {
  connectDB,
  getConnection,
  testConnection
};