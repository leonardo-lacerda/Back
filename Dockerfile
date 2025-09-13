FROM node:18-alpine

# Instalar dependências do sistema
RUN apk add --no-cache \
    tini \
    curl

# Criar diretório da aplicação
WORKDIR /app

# Copiar arquivos de dependências
COPY package*.json ./

# Instalar dependências
RUN npm install --only=production && npm cache clean --force

# Copiar código da aplicação
COPY . .

# Criar usuário não-root
RUN addgroup -g 1001 -S nodejs && \
    adduser -S asaas -u 1001 -G nodejs

# Alterar proprietário dos arquivos
RUN chown -R asaas:nodejs /app
USER asaas

# Expor porta
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:3001/health || exit 1

# Usar tini como init system
ENTRYPOINT ["/sbin/tini", "--"]

# Comando padrão
CMD ["node", "server.js"]