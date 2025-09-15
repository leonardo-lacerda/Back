const axios = require('axios');

class AsaasService {
  constructor() {
    this.apiKey = process.env.ASAAS_API_KEY;
    this.baseURL = process.env.ASAAS_BASE_URL || 'https://api.asaas.com/v3';
    
    if (!this.apiKey) {
      console.error('❌ ASAAS_API_KEY não configurada!');
      throw new Error('ASAAS_API_KEY é obrigatória');
    }

    this.client = axios.create({
      baseURL: this.baseURL,
      headers: {
        'access_token': this.apiKey,
        'Content-Type': 'application/json'
      },
      timeout: 30000
    });

    console.log(`✅ AsaasService inicializado: ${this.baseURL}`);
  }

  async createCustomer(customerData) {
    try {
      console.log('🔄 Criando cliente no Asaas:', customerData);

      const payload = {
        name: customerData.name,
        cpfCnpj: customerData.cpfCnpj,
        email: customerData.email,
        phone: customerData.phone,
        notificationDisabled: false
      };

      const response = await this.client.post('/customers', payload);
      
      console.log('✅ Cliente criado no Asaas:', response.data.id);
      return response.data;

    } catch (error) {
      console.error('❌ Erro ao criar cliente no Asaas:', error.response?.data || error.message);
      
      if (error.response?.data) {
        throw new Error(`Asaas Error: ${JSON.stringify(error.response.data)}`);
      }
      throw new Error(`Erro na API Asaas: ${error.message}`);
    }
  }

  async createPayment(paymentData) {
    try {
      console.log('🔄 Criando pagamento no Asaas:', paymentData);

      const payload = {
        customer: paymentData.customer,
        billingType: paymentData.billingType,
        value: paymentData.value,
        dueDate: paymentData.dueDate,
        description: paymentData.description,
        externalReference: paymentData.externalReference,
        installmentCount: paymentData.installmentCount,
        installmentValue: paymentData.installmentValue,
        // Configurações específicas para PIX
        ...(paymentData.billingType === 'PIX' && {
          pixTransaction: {
            type: 'DYNAMIC'
          }
        })
      };

      const response = await this.client.post('/payments', payload);
      
      console.log('✅ Pagamento criado no Asaas:', response.data.id);
      return response.data;

    } catch (error) {
      console.error('❌ Erro ao criar pagamento no Asaas:', error.response?.data || error.message);
      
      if (error.response?.data) {
        throw new Error(`Asaas Error: ${JSON.stringify(error.response.data)}`);
      }
      throw new Error(`Erro na API Asaas: ${error.message}`);
    }
  }

  async getPayment(paymentId) {
    try {
      console.log('🔄 Buscando pagamento no Asaas:', paymentId);

      const response = await this.client.get(`/payments/${paymentId}`);
      
      console.log('✅ Pagamento encontrado no Asaas:', response.data.id);
      return response.data;

    } catch (error) {
      console.error('❌ Erro ao buscar pagamento no Asaas:', error.response?.data || error.message);
      
      if (error.response?.data) {
        throw new Error(`Asaas Error: ${JSON.stringify(error.response.data)}`);
      }
      throw new Error(`Erro na API Asaas: ${error.message}`);
    }
  }

  async getCustomer(customerId) {
    try {
      console.log('🔄 Buscando cliente no Asaas:', customerId);

      const response = await this.client.get(`/customers/${customerId}`);
      
      console.log('✅ Cliente encontrado no Asaas:', response.data.id);
      return response.data;

    } catch (error) {
      console.error('❌ Erro ao buscar cliente no Asaas:', error.response?.data || error.message);
      
      if (error.response?.data) {
        throw new Error(`Asaas Error: ${JSON.stringify(error.response.data)}`);
      }
      throw new Error(`Erro na API Asaas: ${error.message}`);
    }
  }

  async updateCustomer(customerId, customerData) {
    try {
      console.log('🔄 Atualizando cliente no Asaas:', customerId);

      const payload = {
        name: customerData.name,
        email: customerData.email,
        phone: customerData.phone
      };

      const response = await this.client.post(`/customers/${customerId}`, payload);
      
      console.log('✅ Cliente atualizado no Asaas:', response.data.id);
      return response.data;

    } catch (error) {
      console.error('❌ Erro ao atualizar cliente no Asaas:', error.response?.data || error.message);
      
      if (error.response?.data) {
        throw new Error(`Asaas Error: ${JSON.stringify(error.response.data)}`);
      }
      throw new Error(`Erro na API Asaas: ${error.message}`);
    }
  }

  async cancelPayment(paymentId) {
    try {
      console.log('🔄 Cancelando pagamento no Asaas:', paymentId);

      const response = await this.client.delete(`/payments/${paymentId}`);
      
      console.log('✅ Pagamento cancelado no Asaas:', paymentId);
      return response.data;

    } catch (error) {
      console.error('❌ Erro ao cancelar pagamento no Asaas:', error.response?.data || error.message);
      
      if (error.response?.data) {
        throw new Error(`Asaas Error: ${JSON.stringify(error.response.data)}`);
      }
      throw new Error(`Erro na API Asaas: ${error.message}`);
    }
  }

  // Validar webhook do Asaas
  validateWebhook(payload, signature) {
    // Implementar validação do webhook se necessário
    return true;
  }
}

// Criar instância única (Singleton)
const asaasService = new AsaasService();

// Exportar as funções individuais para compatibilidade
module.exports = {
  createCustomer: (data) => asaasService.createCustomer(data),
  createPayment: (data) => asaasService.createPayment(data),
  getPayment: (id) => asaasService.getPayment(id),
  getCustomer: (id) => asaasService.getCustomer(id),
  updateCustomer: (id, data) => asaasService.updateCustomer(id, data),
  cancelPayment: (id) => asaasService.cancelPayment(id),
  validateWebhook: (payload, signature) => asaasService.validateWebhook(payload, signature),
  asaasService // Exportar a instância também
};