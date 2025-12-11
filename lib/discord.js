const axios = require('axios');

class DiscordNotifier {
    constructor(webhookUrl) {
        this.webhookUrl = webhookUrl;
        this.isEnabled = !!webhookUrl;
        
        if (this.isEnabled) {
            console.log('✅ Discord notifier initialized');
        } else {
            console.log('⚠️ Discord webhook URL not provided - Discord notifications disabled');
        }
    }

    async sendMessage(message, title = null) {
        if (!this.isEnabled) {
            // Discord notifier disabled
            return;
        }

        try {
            const payload = {
                content: title ? `**${title}**\n${message}` : message,
                username: 'DVSA Notifier',
                avatar_url: 'https://cdn.discordapp.com/emojis/🚗.png'
            };

            await axios.post(this.webhookUrl, payload);
            console.log('✅ Discord message sent');
        } catch (error) {
            console.error('❌ Discord error:', error.message);
        }
    }

    async notifySlotFound(groupId, dvsaUsername, slotCount) {
        const message = `🎯 SLOT FOUND!\n\nGroup: ${groupId}\nDVSA Account: ${dvsaUsername}\nSlots: ${slotCount}\n\n✅ Available slots detected!`;
        await this.sendMessage(message, '🎯 SLOT FOUND!');
    }

    async notifyReservationSuccess(testCenter, slots, minutesRemaining, reservedCount = 1) {
        let message = `✅ Slot Secured\n\n📍 ${testCenter}\n\n`;
        
        slots.forEach((slot, index) => {
            message += `Slot${index + 1}: ${slot}\n`;
        });
        
        message += `\n⏰ ${minutesRemaining} minutes remaining`;
        
        await this.sendMessage(message, '✅ Slot Secured');
    }

    async notifySlotLost(locationInfo) {
        const message = `⚠️ SLOT LOST\n\n${locationInfo}\n\nNo slots were secured. Returning to search results.`;
        await this.sendMessage(message, '⚠️ SLOT LOST');
    }

    async notifyHCaptchaDetected(groupId, dvsaUsername, sitekey, url, isReservation = false) {
        if (!isReservation) {
            // Discord: Skipping hCaptcha alert for non-reservation page
            return;
        }

        const message = `🔐 hCaptcha Challenge Detected!\n\nGroup: ${groupId}\nDVSA Account: ${dvsaUsername}\nSitekey: ${sitekey}\nPage: ${url}\n\n⚠️ Manual intervention required\n✅ Will continue monitoring after solving`;
        await this.sendMessage(message, '🔐 hCaptcha Challenge');
    }

    async notifyCredentialMissing(groupId, dvsaUsername, url) {
        const message = `🔑 Credentials Missing!\n\nGroup: ${groupId}\nDVSA Account: ${dvsaUsername}\nPage: ${url}\n\n⚠️ Please save your DVSA credentials in browser\n🔧 Cannot continue without login`;
        await this.sendMessage(message, '🔑 Credentials Missing');
    }
}

module.exports = DiscordNotifier;
