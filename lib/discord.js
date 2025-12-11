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
                username: 'DVSA Bot',
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

    async notifyReservationSuccess(groupId, dvsaUsername, minutesRemaining, reservedCount = 1) {
        const message = `🎉 TEST SLOT BOOKED SUCCESSFULLY!\n\nGroup: ${groupId}\nDVSA Account: ${dvsaUsername}\n\n⏰ Time Remaining: ${minutesRemaining} minutes\n📊 Reserved Tests: ${reservedCount}\n\n✅ Slot has been reserved!\n🚀 You have ${minutesRemaining} minutes to complete the booking process\n\n⚠️ ACTION REQUIRED:\n1. Open Chrome browser NOW\n2. Complete the booking details\n3. Submit payment (if required)\n4. Confirm booking before time expires\n\n🎊 Congratulations! The bot successfully grabbed a slot!`;
        await this.sendMessage(message, '🎉 RESERVATION SUCCESS!');
    }

    async notifyHCaptchaDetected(groupId, dvsaUsername, sitekey, url, isReservation = false) {
        if (!isReservation) {
            // Discord: Skipping hCaptcha alert for non-reservation page
            return;
        }

        const message = `🔐 hCaptcha Challenge Detected!\n\nGroup: ${groupId}\nDVSA Account: ${dvsaUsername}\nSitekey: ${sitekey}\nPage: ${url}\n\n⚠️ Manual intervention required\n🤖 Bot will continue monitoring after solving`;
        await this.sendMessage(message, '🔐 hCaptcha Challenge');
    }

    async notifyCredentialMissing(groupId, dvsaUsername, url) {
        const message = `🔑 Credentials Missing!\n\nGroup: ${groupId}\nDVSA Account: ${dvsaUsername}\nPage: ${url}\n\n⚠️ Please save your DVSA credentials in browser\n🔧 Bot cannot continue without login`;
        await this.sendMessage(message, '🔑 Credentials Missing');
    }
}

module.exports = DiscordNotifier;
