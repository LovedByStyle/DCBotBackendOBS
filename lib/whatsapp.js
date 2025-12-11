const axios = require('axios');

class WhatsAppNotifier {
    constructor(instanceId, apiToken, chatId) {
        this.instanceId = instanceId;
        this.apiToken = apiToken;
        this.chatId = chatId;
        this.baseUrl = `https://api.greenapi.com/waInstance${instanceId}`;

        if (instanceId && apiToken && chatId) {
            console.log('WhatsApp notifier initialized');
        } else {
            console.warn('WhatsApp credentials not provided, notifications disabled');
        }
    }

    async sendMessage(message) {
        if (!this.instanceId || !this.apiToken || !this.chatId) {
            // WhatsApp disabled
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
                console.log(`WhatsApp message sent: ${message}`);
            } else {
                console.warn(`WhatsApp response: ${JSON.stringify(response.data)}`);
            }
        } catch (error) {
            if (error.response) {
                console.error(`WhatsApp send failed: ${error.response.status} - ${JSON.stringify(error.response.data)}`);
            } else {
                console.error(`WhatsApp error: ${error.message}`);
            }
        }
    }

    async notifyReservationSuccess(testCenter, slots, minutesRemaining, reservedCount = 1) {
        let message = `✅ Slot Secured\n\n📍 ${testCenter}\n\n`;
        
        slots.forEach((slot, index) => {
            message += `Slot${index + 1}: ${slot}\n`;
        });
        
        message += `\n⏰ ${minutesRemaining} minutes remaining`;
        
        await this.sendMessage(message);
    }
}

module.exports = WhatsAppNotifier;

