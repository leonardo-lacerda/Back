const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

const paymentRoutes = require('./routes/payment');
const webhookRoutes = require('./routes/webhook');
const { connectDB, testConnection } = require('./config/database');

const app = express();
const PORT = process.env.PORT || 3000;

// Conectar ao banco de dados primeiro
connectDB();

// Configuração CORS mais simples e direta
const allowedOrigins = [
  'https://promptaai.com.br',
  'https://www.promptaai.com.br',
  'http://localhost:3000',
  'http://localhost:5173',
  'http://127.0.0.1:3000',
  'http://127.0.0.1:5173'
];

const corsOptions = {
  origin: function (origin, callback) {
    // Permitir requisições sem origin (mobile apps, Postman, etc.)
    if (!origin) {
      console.log('✅ Requisição sem origin - permitida');
      return callback(null, true);
    }
    
    if (allowedOrigins.includes(origin)) {
      console.log(`✅ Origin permitida: ${origin}`);
      callback(null, true);
    } else {
      console.log(`❌ Origin bloqueada: ${origin}`);
      callback(null, false); // Mudança aqui: não retornar erro, apenas false
    }
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'HEAD', 'PATCH'],
  allowedHeaders: [
    'Origin',
    'X-Requested-With', 
    'Content-Type', 
    'Accept',
    'Authorization',
    'Cache-Control',
    'Pragma'
  ],
  credentials: true,
  optionsSuccessStatus: 200, // Para suportar navegadores legados
  preflightContinue: false
};

// Aplicar CORS ANTES de todos os outros middlewares
app.use(cors(corsOptions));

// Middleware para tratar preflight requests manualmente (fallback)
app.use((req, res, next) => {
  const origin = req.headers.origin;
  
  if (req.method === 'OPTIONS') {
    console.log(`🔄 Preflight request de: ${origin}`);
    
    if (!origin || allowedOrigins.includes(origin)) {
      res.header('Access-Control-Allow-Origin', origin || '*');
      res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS,HEAD,PATCH');
      res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization, Cache-Control, Pragma');
      res.header('Access-Control-Allow-Credentials', 'true');
      res.header('Access-Control-Max-Age', '86400'); // 24 horas
      return res.status(200).end();
    } else {
      console.log(`❌ Preflight bloqueado para: ${origin}`);
      return res.status(403).end();
    }
  }
  
  // Para requisições normais, também definir headers
  if (!origin || allowedOrigins.includes(origin)) {
    res.header('Access-Control-Allow-Origin', origin || '*');
    res.header('Access-Control-Allow-Credentials', 'true');
  }
  
  next();
});

// Middlewares de segurança (depois do CORS)
app.use(helmet({
  crossOriginEmbedderPolicy: false, // Desabilitar para evitar conflitos com CORS
  contentSecurityPolicy: false // Desabilitar CSP que pode interferir
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 100, // máximo 100 requests por IP por janela
  message: {
    error: 'Muitas tentativas. Tente novamente em 15 minutos.'
  },
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api/', limiter);

// Body parser
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Middleware de log detalhado
app.use((req, res, next) => {
  const timestamp = new Date().toISOString();
  const origin = req.get('origin') || 'sem origin';
  const userAgent = req.get('user-agent') || 'sem user-agent';
  
  console.log(`${timestamp} - ${req.method} ${req.path}`);
  console.log(`  Origin: ${origin}`);
  console.log(`  Headers: ${JSON.stringify(req.headers, null, 2)}`);
  
  if (req.method === 'POST' && req.body) {
    console.log(`  Body: ${JSON.stringify(req.body, null, 2)}`);
  }
  
  next();
});

app.get('/', (req, res) => {
  console.log('🏠 Health check Railway - rota raiz acessada');
  
  // Resposta rápida sem dependências externas
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-cache');
  
  return res.status(200).json({
    status: 'OK',
    message: 'Servidor funcionando',
    timestamp: new Date().toISOString(),
    port: PORT,
    environment: process.env.NODE_ENV || 'development',
    service: 'Backend API - PromptaAI'
  });
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
      database: 'Conectado',
      cors: 'Habilitado',
      allowedOrigins: allowedOrigins
    });
  } catch (error) {
    console.error('❌ Erro no health check:', error);
    res.status(500).json({ 
      status: 'ERROR', 
      message: 'Erro no servidor',
      timestamp: new Date().toISOString(),
      database: 'Desconectado',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Erro interno'
    });
  }
});

// Rota de teste CORS
app.get('/api/test-cors', (req, res) => {
  const origin = req.get('origin');
  console.log(`🧪 Teste CORS de: ${origin}`);
  
  res.json({
    message: 'CORS funcionando!',
    origin: origin,
    timestamp: new Date().toISOString(),
    headers: req.headers,
    allowedOrigins: allowedOrigins,
    isAllowed: !origin || allowedOrigins.includes(origin)
  });
});

// Rota 404
app.use('*', (req, res) => {
  console.log(`❌ Rota não encontrada: ${req.method} ${req.originalUrl}`);
  res.status(404).json({ 
    error: 'Rota não encontrada',
    method: req.method,
    path: req.originalUrl,
    availableEndpoints: [
      'GET /health',
      'GET /api/test-cors',
      'POST /api/create-payment',
      'POST /api/create-subscription',
      'GET /api/payment-status/:id',
      'GET /api/payments',
      'POST /api/webhook/asaas'
    ]
  });
});

// Error handler global
app.use((error, req, res, next) => {
  console.error('❌ Erro global:', error);
  
  // Se for erro de CORS, retornar resposta específica
  if (error.message && error.message.includes('CORS')) {
    return res.status(403).json({ 
      error: 'Erro de CORS',
      message: 'Origin não permitida',
      origin: req.get('origin')
    });
  }
  
  res.status(500).json({ 
    error: 'Erro interno do servidor',
    message: process.env.NODE_ENV === 'development' ? error.message : 'Erro interno',
    timestamp: new Date().toISOString()
  });
});

// Tratamento de sinais para shutdown graceful
process.on('SIGTERM', () => {
  console.log('🛑 Recebido SIGTERM, fechando servidor...');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('🛑 Recebido SIGINT, fechando servidor...');
  process.exit(0);
});

// Iniciar servidor
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log('🚀 Servidor iniciado com sucesso!');
  console.log(`📍 Porta: ${PORT}`);
  console.log(`🌍 Ambiente: ${process.env.NODE_ENV || 'development'}`);
  console.log(`🔗 Health check: http://localhost:${PORT}/health`);
  console.log(`🧪 Teste CORS: http://localhost:${PORT}/api/test-cors`);
  console.log(`📡 CORS habilitado para:`);
  allowedOrigins.forEach(origin => console.log(`   - ${origin}`));
  console.log('✅ Pronto para receber requisições!');
});

// Timeout para requisições
server.timeout = 30000; // 30 segundos

module.exports = app;