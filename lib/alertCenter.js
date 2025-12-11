const TelegramBot = require('./telegram');
const DiscordNotifier = require('./discord');
const WhatsAppNotifier = require('./whatsapp');

class AlertCenter {
    constructor(telegramToken, telegramChatId, discordWebhookUrl, whatsappInstanceId, whatsappApiToken, whatsappChatId) {
        this.telegram = new TelegramBot(telegramToken, telegramChatId);
        this.discord = new DiscordNotifier(discordWebhookUrl);
        this.whatsapp = new WhatsAppNotifier(whatsappInstanceId, whatsappApiToken, whatsappChatId);
        
        console.log('✅ Alert Center initialized');
    }

    // Centralized notification methods
    async notifyServerStarted() {
        const message = '🚀 DVSA Control Center Started';
        await Promise.all([
            this.telegram.sendMessage(message),
            this.discord.sendMessage(message, '🚀 Server Started')
        ]);
    }

    async notifySlotFound(groupId, dvsaUsername, slotCount) {
        const message = `🎯 SLOT FOUND!\n\nGroup: ${groupId}\nDVSA Account: ${dvsaUsername}\nSlots: ${slotCount}\n\n✅ Available slots detected!`;
        await Promise.all([
            this.telegram.notifySlotFound(groupId, dvsaUsername, slotCount),
            this.discord.notifySlotFound(groupId, dvsaUsername, slotCount)
        ]);
    }

    async notifyReservationSuccess(testCenter, slots, minutesRemaining, reservedCount = 1) {
        await Promise.all([
            this.telegram.notifyReservationSuccess(testCenter, slots, minutesRemaining, reservedCount),
            this.discord.notifyReservationSuccess(testCenter, slots, minutesRemaining, reservedCount),
            this.whatsapp.notifyReservationSuccess(testCenter, slots, minutesRemaining, reservedCount)
        ]);
    }

    async notifySlotLost(locationInfo) {
        await Promise.all([
            this.telegram.notifySlotLost(locationInfo),
            this.discord.notifySlotLost(locationInfo)
        ]);
    }

    async notifyHCaptchaDetected(groupId, dvsaUsername, sitekey, url, isReservation = false) {
        await Promise.all([
            this.telegram.notifyHCaptchaDetected(groupId, dvsaUsername, sitekey, isReservation),
            this.discord.notifyHCaptchaDetected(groupId, dvsaUsername, sitekey, url, isReservation)
        ]);
    }

    async notifyCredentialMissing(groupId, dvsaUsername, userIdFilled, passwordFilled) {
        await Promise.all([
            this.telegram.notifyCredentialMissing(groupId, dvsaUsername, userIdFilled, passwordFilled),
            this.discord.notifyCredentialMissing(groupId, dvsaUsername, 'https://driver-services.dvsa.gov.uk')
        ]);
    }

    async notifyClickLimit(groupId, dvsaUsername, clicks, clickLimit = 9500) {
        const message = `⚠️ Click limit warning - Group: ${groupId}, DVSA Account: ${dvsaUsername}, Clicks: ${clicks}/${clickLimit}`;
        await Promise.all([
            this.telegram.notifyClickLimit(groupId, dvsaUsername, clicks),
            this.discord.sendMessage(message, '⚠️ Click Limit Warning')
        ]);
    }

    async notifyBotDown(groupId, dvsaUsername) {
        const message = `❌ Notifier stopped - Group: ${groupId}, DVSA Account: ${dvsaUsername}`;
        await Promise.all([
            this.telegram.notifyBotDown(groupId, dvsaUsername),
            this.discord.sendMessage(message, '❌ Notifier Stopped')
        ]);
    }

    async notifyGroupResumed(groupId) {
        const message = `▶️ Group resumed - Group: ${groupId}`;
        await Promise.all([
            this.telegram.notifyGroupResumed(groupId),
            this.discord.sendMessage(message, '▶️ Group Resumed')
        ]);
    }
}

module.exports = AlertCenter;
