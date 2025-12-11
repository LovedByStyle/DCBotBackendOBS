const axios = require('axios');
const logger = require('./logger');

class WhatsAppNotifier {
    constructor(instanceId, apiToken, chatId) {
        this.instanceId = instanceId;
        this.apiToken = apiToken;
        this.chatId = chatId;
        this.baseUrl = `https://api.greenapi.com/waInstance${instanceId}`;

        if (instanceId && apiToken && chatId) {
            logger.info('WhatsApp notifier initialized');
        } else {
            logger.warn('WhatsApp credentials not provided, notifications disabled');
        }
    }

    async sendMessage(message) {
        if (!this.instanceId || !this.apiToken || !this.chatId) {
            logger.debug(`WhatsApp disabled - would send: ${message}`);
            return;
        }

        try {
            const url = `${this.baseUrl}/sendMessage/${this.apiToken}`;
            const response = await axios.post(url, {
                chatId: this.chatId,
                message: message
            }, {
                headers: {
                    'Content-Type': 'application/json'
                }
            });

            if (response.data && response.data.idMessage) {
                logger.info(`WhatsApp message sent: ${message}`);
            } else {
                logger.warn(`WhatsApp response: ${JSON.stringify(response.data)}`);
            }
        } catch (error) {
            if (error.response) {
                logger.error(`WhatsApp send failed: ${error.response.status} - ${JSON.stringify(error.response.data)}`);
            } else {
                logger.error(`WhatsApp error: ${error.message}`);
            }
        }
    }

    async notifyReservationSuccess() {
        await this.sendMessage('Slot secured');
    }
}

module.exports = WhatsAppNotifier;

