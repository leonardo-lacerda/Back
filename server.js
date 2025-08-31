const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

const paymentRoutes = require('./routes/payment');
const webhookRoutes = require('./routes/webhook');
const { connectDB, testConnection } = require('./config/database');

const app = express();
const PORT = process.env.PORT || 3001;

// Middlewares de segurança
app.use(helmet());

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 100, // máximo 100 requests por IP por janela
  message: {
    error: 'Muitas tentativas. Tente novamente em 15 minutos.'
  }
});
app.use('/api/', limiter);

// CORS - Configuração para múltiplas origens
const corsOptions = {
  origin: function (origin, callback) {
    // Permitir requisições sem origin (mobile apps, Postman, etc.)
    if (!origin) return callback(null, true);
    
    const allowedOrigins = [
      'https://promptaai.com.br',
      'https://www.promptaai.com.br',
      'http://localhost:3000',
      'http://localhost:5173',
      'http://127.0.0.1:3000',
      'http://127.0.0.1:5173'
    ];
    
    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      console.log(`❌ Origem bloqueada pelo CORS: ${origin}`);
      callback(new Error('Não permitido pelo CORS'));
    }
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept'],
  credentials: true,
  optionsSuccessStatus: 200,
  preflightContinue: false
};

app.use(cors(corsOptions));

// Middleware adicional para debug de CORS
app.use((req, res, next) => {
  console.log(`🌍 ${req.method} ${req.path} - Origin: ${req.get('origin') || 'sem origin'}`);
  console.log(`📋 Headers: ${JSON.stringify(req.headers)}`);
  next();
});

// Body parser
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Conectar ao banco de dados
connectDB();

// Middleware de log
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path} - Origin: ${req.get('origin')}`);
  next();
});

// Rotas
app.use('/api', paymentRoutes);
app.use('/api/webhook', webhookRoutes);

// Rota de health check
app.get('/health', async (req, res) => {
  try {
    await testConnection();
    res.status(200).json({ 
      status: 'OK', 
      message: 'Servidor funcionando',
      timestamp: new Date().toISOString(),
      database: 'Conectado'
    });
  } catch (error) {
    res.status(500).json({ 
      status: 'ERROR', 
      message: 'Erro no servidor',
      timestamp: new Date().toISOString(),
      database: 'Desconectado'
    });
  }
});

// Rota de teste CORS
app.get('/test-cors', (req, res) => {
  res.json({
    message: 'CORS funcionando!',
    origin: req.get('origin'),
    timestamp: new Date().toISOString()
  });
});

app.options('*', cors(corsOptions)); // Habilita preflight para todas as rotas

// Rota 404
app.use('*', (req, res) => {
  res.status(404).json({ 
    error: 'Rota não encontrada',
    availableEndpoints: [
      'GET /health',
      'POST /api/create-payment',
      'GET /api/payment-status/:id',
      'POST /api/webhook/asaas'
    ]
  });
});

// Error handler
app.use((error, req, res, next) => {
  console.error('Erro:', error);
  res.status(500).json({ 
    error: 'Erro interno do servidor',
    message: process.env.NODE_ENV === 'development' ? error.message : 'Erro interno'
  });
});

// Iniciar servidor
app.listen(PORT, '0.0.0.0', () => {
  const allowedOrigins = [
    'https://promptaai.com.br',
    'https://www.promptaai.com.br',
    'http://localhost:3000',
    'http://localhost:5173'
  ];
  
  console.log(`🚀 Servidor rodando na porta ${PORT}`);
  console.log(`🌍 Ambiente: ${process.env.NODE_ENV}`);
  console.log(`🔗 Health check: http://localhost:${PORT}/health`);
  console.log(`📡 CORS habilitado para: ${allowedOrigins.join(', ')}`);
});

module.exports = app;