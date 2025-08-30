const axios = require('axios');

class AsaasService {
  constructor() {
    this.apiUrl = process.env.ASAAS_API_URL;
    this.apiKey = process.env.ASAAS_API_KEY;
    
    this.client = axios.create({
      baseURL: this.apiUrl,
      headers: {
        'access_token': this.apiKey,
        'Content-Type': 'application/json'
      },
      timeout: 30000
    });
  }

  // Criar ou atualizar cliente no Asaas
  async createOrUpdateCustomer(customerData) {
    try {
      const payload = {
        name: customerData.name,
        email: customerData.email,
        cpfCnpj: customerData.cpf.replace(/\D/g, ''),
        phone: customerData.phone.replace(/\D/g, ''),
        notificationDisabled: false,
        emailNotification: true,
        smsNotification: false,
        whatsappNotification: true
      };

      // Primeiro tenta buscar cliente existente por CPF
      const existingCustomer = await this.getCustomerByCpf(payload.cpfCnpj);
      
      if (existingCustomer) {
        // Atualizar cliente existente
        const response = await this.client.put(`/customers/${existingCustomer.id}`, payload);
        return response.data;
      } else {
        // Criar novo cliente
        const response = await this.client.post('/customers', payload);
        return response.data;
      }
    } catch (error) {
      console.error('Erro ao criar/atualizar cliente no Asaas:', error.response?.data || error.message);
      throw new Error('Erro ao processar cliente no Asaas');
    }
  }

  // Buscar cliente por CPF
  async getCustomerByCpf(cpf) {
    try {
      const response = await this.client.get('/customers', {
        params: { cpfCnpj: cpf }
      });
      
      if (response.data.data && response.data.data.length > 0) {
        return response.data.data[0];
      }
      return null;
    } catch (error) {
      console.error('Erro ao buscar cliente por CPF:', error.response?.data || error.message);
      return null;
    }
  }

  // Criar cobrança
  async createPayment(paymentData) {
    try {
      const dueDate = new Date();
      dueDate.setDate(dueDate.getDate() + 3); // 3 dias para vencimento

      const payload = {
        customer: paymentData.asaasCustomerId,
        billingType: paymentData.paymentMethod === 'PIX' ? 'PIX' : 'CREDIT_CARD',
        value: paymentData.amount,
        dueDate: dueDate.toISOString().split('T')[0],
        description: `Assinatura ${paymentData.planType} - Automação WhatsApp`,
        externalReference: `PLAN_${paymentData.planType}_${Date.now()}`,
        discount: {
          value: 0,
          dueDateLimitDays: 0
        },
        fine: {
          value: 2.00,
          type: 'PERCENTAGE'
        },
        interest: {
          value: 1.00,
          type: 'PERCENTAGE'
        },
        postalService: false,
        callback: {
          successUrl: `${process.env.FRONTEND_URL}/success`,
          autoRedirect: true
        }
      };

      const response = await this.client.post('/payments', payload);
      return response.data;
    } catch (error) {
      console.error('Erro ao criar cobrança no Asaas:', error.response?.data || error.message);
      throw new Error('Erro ao criar cobrança no Asaas');
    }
  }

  // Obter informações da cobrança
  async getPayment(paymentId) {
    try {
      const response = await this.client.get(`/payments/${paymentId}`);
      return response.data;
    } catch (error) {
      console.error('Erro ao buscar cobrança:', error.response?.data || error.message);
      throw new Error('Erro ao buscar cobrança');
    }
  }

  // Obter código PIX
  async getPixCode(paymentId) {
    try {
      const response = await this.client.get(`/payments/${paymentId}/pixQrCode`);
      return response.data;
    } catch (error) {
      console.error('Erro ao obter código PIX:', error.response?.data || error.message);
      return null;
    }
  }

  // Cancelar cobrança
  async cancelPayment(paymentId) {
    try {
      const response = await this.client.delete(`/payments/${paymentId}`);
      return response.data;
    } catch (error) {
      console.error('Erro ao cancelar cobrança:', error.response?.data || error.message);
      throw new Error('Erro ao cancelar cobrança');
    }
  }

  // Verificar status da cobrança
  async checkPaymentStatus(paymentId) {
    try {
      const payment = await this.getPayment(paymentId);
      
      let pixData = null;
      if (payment.billingType === 'PIX' && payment.status === 'PENDING') {
        pixData = await this.getPixCode(paymentId);
      }

      return {
        ...payment,
        pixData
      };
    } catch (error) {
      console.error('Erro ao verificar status:', error.response?.data || error.message);
      throw new Error('Erro ao verificar status da cobrança');
    }
  }
}

module.exports = new AsaasService();