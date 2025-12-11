const TelegramBot = require('node-telegram-bot-api');

class TelegramNotifier {
    constructor(token, chatId) {
        this.token = token;
        this.chatId = chatId;
        this.bot = null;

        if (token && chatId) {
            try {
                this.bot = new TelegramBot(token, { polling: false });
                console.log('Telegram bot initialized');
            } catch (error) {
                console.error(`Telegram initialization failed: ${error.message}`);
            }
        } else {
            console.warn('Telegram credentials not provided, notifications disabled');
        }
    }

    async sendMessage(text) {
        if (!this.bot || !this.chatId) {
            // Telegram disabled
            return;
        }

        try {
            await this.bot.sendMessage(this.chatId, text);
            // Telegram message sent
        } catch (error) {
            console.error(`Telegram send failed: ${error.message}`);
        }
    }

    async notifySlotFound(groupId, dvsaUsername, slotCount = 1) {
        const message = `🎯 SLOT FOUND!\n\nGroup: ${groupId}\nDVSA Account: ${dvsaUsername}\nSlots: ${slotCount}\n\n✅ Dispatching to claim all slots!`;
        await this.sendMessage(message);
    }

    async notifyGroupResumed(groupId) {
        const message = `▶️ Group ${groupId} RESUMED\n\nContinuing slot monitoring...`;
        await this.sendMessage(message);
    }

    async notifyBotDown(groupId, dvsaUsername) {
        const message = `⚠️ Notifier stopped\n\nGroup: ${groupId}\nDVSA Account: ${dvsaUsername}\n\nNo heartbeat received`;
        await this.sendMessage(message);
    }

    async notifyClickLimit(groupId, dvsaUsername, clicks) {
        const message = `⚠️ CLICK LIMIT WARNING\n\nGroup: ${groupId}\nDVSA Account: ${dvsaUsername}\nClicks: ${clicks}/9500\n\nApproaching limit!`;
        await this.sendMessage(message);
    }

    async notifySystemError(error) {
        const message = `🚨 SYSTEM ERROR\n\n${error}`;
        await this.sendMessage(message);
    }

    async notifyHCaptchaDetected(groupId, dvsaUsername, sitekey, isReservation = false) {
        // Only send alerts for reservation pages - skip non-reservation alerts
        if (!isReservation) {
            // Skipping non-reservation hCaptcha alert
            return;
        }

        // Critical alert - captcha during slot reservation
        const message = `🎯 HCAPTCHA DURING RESERVATION!\n\nGroup: ${groupId}\nDVSA Account: ${dvsaUsername}\nSitekey: ${sitekey}\nPage: Slot Reservation\n\n🚨 URGENT ACTION REQUIRED:\n1. Open Chrome browser NOW\n2. Navigate to reservation page\n3. Solve the hCaptcha\n4. Complete slot reservation\n\n⏰ Time sensitive - reservation may timeout!`;

        await this.sendMessage(message);
    }

    async notifyCredentialMissing(groupId, dvsaUsername, userIdFilled, passwordFilled) {
        let missingFields = [];
        if (!userIdFilled) missingFields.push('User ID');
        if (!passwordFilled) missingFields.push('Password');

        const missingText = missingFields.length > 0 ? missingFields.join(' & ') : 'Credentials';

        const message = `🔐 DVSA CREDENTIALS MISSING!\n\nGroup: ${groupId}\nDVSA Account: ${dvsaUsername}\n\nMissing: ${missingText}\nPage: Government Gateway Login\n\n⚠️ ACTION REQUIRED:\n1. Open extension popup\n2. Enter DVSA Username & Password\n3. Click "Save Configuration"\n4. Will auto-login next time\n\nURL: https://www.access.service.gov.uk/login/signin/creds`;
        await this.sendMessage(message);
    }

    async notifyReservationSuccess(testCenter, slots, minutesRemaining, reservedCount = 1) {
        let message = `✅ Slot Secured\n\n📍 ${testCenter}\n\n`;
        
        slots.forEach((slot, index) => {
            message += `Slot${index + 1}: ${slot}\n`;
        });
        
        message += `\n⏰ ${minutesRemaining} minutes remaining`;
        
        await this.sendMessage(message);
    }

    async notifySlotLost(locationInfo) {
        const message = `⚠️ SLOT LOST\n\n${locationInfo}\n\nNo slots were secured. Returning to search results.`;
        await this.sendMessage(message);
    }
}

module.exports = TelegramNotifier;
