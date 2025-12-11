const mongoose = require('mongoose');

// MongoDB Schemas
const groupSchema = new mongoose.Schema({
    group_id: { type: String, required: true, unique: true, index: true },
    status: { type: String, default: 'active', enum: ['active', 'paused', 'stopped'] },
    created_at: { type: Date, default: Date.now },
    updated_at: { type: Date, default: Date.now }
});

const botSchema = new mongoose.Schema({
    group_id: { type: String, required: true, index: true },
    dvsa_username: { type: String, required: true },
    clicks_used: { type: Number, default: 0 },
    clicks_limit: { type: Number, default: 9500 },
    // Button click tracking
    button_clicks: {
        next_available: { type: Number, default: 0 },
        previous_available: { type: Number, default: 0 },
        next_week: { type: Number, default: 0 },
        previous_week: { type: Number, default: 0 }
    },
    status: { type: String, default: 'offline', enum: ['active', 'offline', 'paused', 'dead'] },
    last_heartbeat: { type: Date },
    last_action: { type: String },
    created_at: { type: Date, default: Date.now },
    updated_at: { type: Date, default: Date.now }
});

// Compound index for group_id + dvsa_username uniqueness
botSchema.index({ group_id: 1, dvsa_username: 1 }, { unique: true });

const eventSchema = new mongoose.Schema({
    group_id: { type: String, index: true },
    dvsa_username: { type: String, index: true },
    event_type: { type: String, required: true, index: true },
    message: { type: String },
    data: { type: mongoose.Schema.Types.Mixed },
    timestamp: { type: Date, default: Date.now, index: true }
});

const slotSchema = new mongoose.Schema({
    group_id: { type: String, required: true, index: true },
    dvsa_username: { type: String, required: true },
    slot_count: { type: Number, default: 1 },
    timestamp: { type: Date, default: Date.now, index: true },
    completed: { type: Boolean, default: false }
});

// Common Settings Schema - Shared settings across all Chrome extensions
const commonSettingsSchema = new mongoose.Schema({
    jitter_min: { type: Number, default: 0.8, min: 0.1, max: 5 },
    jitter_max: { type: Number, default: 1.5, min: 0.1, max: 5 },
    max_clicks: { type: Number, default: 9500, min: 100, max: 50000 },
    max_running_time: { type: Number, default: 20, min: 1, max: 120 }, // minutes
    cooldown_time: { type: Number, default: 45, min: 1, max: 180 }, // minutes
    deadline_date: { type: Date, default: () => {
        const threeMonthsFromNow = new Date();
        threeMonthsFromNow.setMonth(threeMonthsFromNow.getMonth() + 3);
        return threeMonthsFromNow;
    }}, // Target deadline date for test slots
    created_at: { type: Date, default: Date.now },
    updated_at: { type: Date, default: Date.now }
});

// Account Schema - Individual DVSA accounts
const accountSchema = new mongoose.Schema({
    account_name: { type: String, required: true, unique: true },
    dvsa_username: { type: String, required: true },
    dvsa_password: { type: String, default: '' },
    enabled: { type: Boolean, default: true },
    created_at: { type: Date, default: Date.now },
    updated_at: { type: Date, default: Date.now }
});

// Daily Click Tracking Schema
const dailyClickSchema = new mongoose.Schema({
    account_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Account', required: true, index: true },
    dvsa_username: { type: String, required: true, index: true },
    date: { type: String, required: true, index: true }, // Format: YYYY-MM-DD in UK timezone
    clicks_today: { type: Number, default: 0 },
    button_breakdown: {
        next_available: { type: Number, default: 0 },
        previous_available: { type: Number, default: 0 },
        next_week: { type: Number, default: 0 },
        previous_week: { type: Number, default: 0 }
    },
    last_click_at: { type: Date, default: Date.now },
    created_at: { type: Date, default: Date.now },
    updated_at: { type: Date, default: Date.now }
});

// Bot Session Tracking Schema
const botSessionSchema = new mongoose.Schema({
    account_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Account', required: true, index: true },
    dvsa_username: { type: String, required: true, index: true },
    session_start: { type: Date, required: true, index: true },
    session_end: { type: Date },
    duration_minutes: { type: Number },
    clicks_during_session: { type: Number, default: 0 },
    status: { type: String, enum: ['running', 'completed', 'stopped'], default: 'running' },
    created_at: { type: Date, default: Date.now },
    updated_at: { type: Date, default: Date.now }
});

// Compound index for account_id + date uniqueness
dailyClickSchema.index({ account_id: 1, date: 1 }, { unique: true });

// Models
const Group = mongoose.model('Group', groupSchema);
const Bot = mongoose.model('Bot', botSchema);
const Event = mongoose.model('Event', eventSchema);
const Slot = mongoose.model('Slot', slotSchema);
const CommonSettings = mongoose.model('CommonSettings', commonSettingsSchema);
const Account = mongoose.model('Account', accountSchema);
const DailyClick = mongoose.model('DailyClick', dailyClickSchema);
const BotSession = mongoose.model('BotSession', botSessionSchema);

class DatabaseManager {
    constructor(mongoUri) {
        this.mongoUri = mongoUri;
        this.isConnected = false;
    }

    async connect() {
        try {
            await mongoose.connect(this.mongoUri, {
                useNewUrlParser: true,
                useUnifiedTopology: true,
                serverSelectionTimeoutMS: 5000
            });

            this.isConnected = true;
            console.log(`MongoDB connected successfully`);

            // Handle connection events
            mongoose.connection.on('error', (err) => {
                console.error(`MongoDB connection error: ${err.message}`);
            });

            mongoose.connection.on('disconnected', () => {
                console.warn('MongoDB disconnected');
                this.isConnected = false;
            });

            mongoose.connection.on('reconnected', () => {
                console.log('MongoDB reconnected');
                this.isConnected = true;
            });

        } catch (error) {
            console.error(`MongoDB connection failed: ${error.message}`);
            throw error;
        }
    }

    // ===== Group Operations =====
    async upsertGroup(groupId, status = 'active') {
        try {
            const result = await Group.findOneAndUpdate(
                { group_id: groupId },
                {
                    group_id: groupId,
                    status: status,
                    updated_at: new Date()
                },
                { upsert: true, new: true }
            );
            return result;
        } catch (error) {
            console.error(`upsertGroup error: ${error.message}`);
            throw error;
        }
    }

    async getGroup(groupId) {
        try {
            return await Group.findOne({ group_id: groupId });
        } catch (error) {
            console.error(`getGroup error: ${error.message}`);
            return null;
        }
    }

    async updateGroupStatus(groupId, status) {
        try {
            await Group.updateOne(
                { group_id: groupId },
                { status: status, updated_at: new Date() }
            );
        } catch (error) {
            console.error(`updateGroupStatus error: ${error.message}`);
        }
    }

    // ===== Bot Operations =====
    async upsertBot(groupId, dvsaUsername, data = {}) {
        try {
            const result = await Bot.findOneAndUpdate(
                { group_id: groupId, dvsa_username: dvsaUsername },
                {
                    group_id: groupId,
                    dvsa_username: dvsaUsername,
                    status: data.status || 'active',
                    last_heartbeat: new Date(),
                    updated_at: new Date()
                },
                { upsert: true, new: true }
            );
            return result;
        } catch (error) {
            console.error(`upsertBot error: ${error.message}`);
            throw error;
        }
    }

    async getBot(groupId, dvsaUsername) {
        try {
            return await Bot.findOne({ group_id: groupId, dvsa_username: dvsaUsername });
        } catch (error) {
            console.error(`getBot error: ${error.message}`);
            return null;
        }
    }

    async getBotsByGroup(groupId) {
        try {
            return await Bot.find({ group_id: groupId }).sort({ dvsa_username: 1 });
        } catch (error) {
            console.error(`getBotsByGroup error: ${error.message}`);
            return [];
        }
    }

    async getAllBots() {
        try {
            return await Bot.find({}).sort({ group_id: 1, dvsa_username: 1 });
        } catch (error) {
            console.error(`getAllBots error: ${error.message}`);
            return [];
        }
    }

    async updateBotClicks(groupId, dvsaUsername, clicks) {
        try {
            await Bot.updateOne(
                { group_id: groupId, dvsa_username: dvsaUsername },
                { clicks_used: clicks, updated_at: new Date() }
            );
        } catch (error) {
            console.error(`updateBotClicks error: ${error.message}`);
        }
    }

    async incrementButtonClick(groupId, dvsaUsername, buttonType) {
        try {
            const updateField = `button_clicks.${buttonType}`;
            await Bot.updateOne(
                { group_id: groupId, dvsa_username: dvsaUsername },
                { 
                    $inc: { 
                        [updateField]: 1,
                        clicks_used: 1 
                    },
                    updated_at: new Date() 
                }
            );
            // Incremented clicks
        } catch (error) {
            console.error(`incrementButtonClick error: ${error.message}`);
        }
    }

    async updateBotStatus(groupId, dvsaUsername, status) {
        try {
            await Bot.updateOne(
                { group_id: groupId, dvsa_username: dvsaUsername },
                { status: status, updated_at: new Date() }
            );
        } catch (error) {
            console.error(`updateBotStatus error: ${error.message}`);
        }
    }

    async updateBotHeartbeat(groupId, dvsaUsername) {
        try {
            await Bot.updateOne(
                { group_id: groupId, dvsa_username: dvsaUsername },
                { last_heartbeat: new Date(), updated_at: new Date() }
            );
        } catch (error) {
            console.error(`updateBotHeartbeat error: ${error.message}`);
        }
    }

    // ===== Event Logging =====
    async logEvent(groupId, dvsaUsername, eventType, message, data = null) {
        try {
            const event = new Event({
                group_id: groupId,
                dvsa_username: dvsaUsername,
                event_type: eventType,
                message: message,
                data: data
            });
            await event.save();
        } catch (error) {
            console.error(`logEvent error: ${error.message}`);
        }
    }

    async getRecentLogs(limit = 100) {
        try {
            const logs = await Event.find({})
                .sort({ timestamp: -1 })
                .limit(limit)
                .lean();

            // Convert MongoDB documents to plain objects for compatibility
            return logs.map(log => ({
                id: log._id.toString(),
                group_id: log.group_id,
                dvsa_username: log.dvsa_username,
                event_type: log.event_type,
                message: log.message,
                data: log.data ? JSON.stringify(log.data) : null,
                timestamp: Math.floor(log.timestamp.getTime() / 1000) // Unix timestamp
            }));
        } catch (error) {
            console.error(`getRecentLogs error: ${error.message}`);
            return [];
        }
    }

    async getGroupLogs(groupId, limit = 50) {
        try {
            const logs = await Event.find({ group_id: groupId })
                .sort({ timestamp: -1 })
                .limit(limit)
                .lean();

            return logs.map(log => ({
                id: log._id.toString(),
                group_id: log.group_id,
                dvsa_username: log.dvsa_username,
                event_type: log.event_type,
                message: log.message,
                data: log.data ? JSON.stringify(log.data) : null,
                timestamp: Math.floor(log.timestamp.getTime() / 1000) // Unix timestamp
            }));
        } catch (error) {
            console.error(`getGroupLogs error: ${error.message}`);
            return [];
        }
    }

    // ===== Slot Tracking =====
    async recordSlotFound(groupId, dvsaUsername, slotCount = 1) {
        try {
            const slot = new Slot({
                group_id: groupId,
                dvsa_username: dvsaUsername,
                slot_count: slotCount
            });
            await slot.save();
        } catch (error) {
            console.error(`recordSlotFound error: ${error.message}`);
        }
    }

    async markSlotCompleted(groupId, dvsaUsername) {
        try {
            await Slot.updateOne(
                {
                    group_id: groupId,
                    dvsa_username: dvsaUsername,
                    completed: false
                },
                { completed: true },
                { sort: { timestamp: -1 } }
            );
        } catch (error) {
            console.error(`markSlotCompleted error: ${error.message}`);
        }
    }

    async getSlotStats() {
        try {
            const stats = await Slot.aggregate([
                {
                    $group: {
                        _id: '$group_id',
                        total_slots: { $sum: 1 },
                        completed_slots: {
                            $sum: { $cond: ['$completed', 1, 0] }
                        }
                    }
                }
            ]);

            // Convert to array format matching SQLite output
            return stats.map(stat => ({
                group_id: stat._id,
                total_slots: stat.total_slots,
                completed_slots: stat.completed_slots
            }));
        } catch (error) {
            console.error(`getSlotStats error: ${error.message}`);
            return [];
        }
    }

    // ===== Utility Methods =====
    async healthCheck() {
        try {
            if (!this.isConnected) {
                return { status: 'disconnected', message: 'MongoDB is not connected' };
            }

            // Ping database
            await mongoose.connection.db.admin().ping();

            return {
                status: 'healthy',
                message: 'MongoDB connection is healthy',
                connected: this.isConnected
            };
        } catch (error) {
            return {
                status: 'error',
                message: error.message,
                connected: this.isConnected
            };
        }
    }

    async getStats() {
        try {
            const [groupCount, botCount, eventCount, slotCount] = await Promise.all([
                Group.countDocuments(),
                Bot.countDocuments(),
                Event.countDocuments(),
                Slot.countDocuments()
            ]);

            return {
                groups: groupCount,
                bots: botCount,
                events: eventCount,
                slots: slotCount
            };
        } catch (error) {
            console.error(`getStats error: ${error.message}`);
            return null;
        }
    }

    async clearOldEvents(daysToKeep = 30) {
        try {
            const cutoffDate = new Date();
            cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);

            const result = await Event.deleteMany({
                timestamp: { $lt: cutoffDate }
            });

            console.log(`Cleared ${result.deletedCount} old events (older than ${daysToKeep} days)`);
            return result.deletedCount;
        } catch (error) {
            console.error(`clearOldEvents error: ${error.message}`);
            return 0;
        }
    }

    async clearGroupLogs(groupId) {
        try {
            const result = await Event.deleteMany({
                group_id: groupId
            });

            console.log(`Cleared ${result.deletedCount} logs for group ${groupId}`);
            return result.deletedCount;
        } catch (error) {
            console.error(`clearGroupLogs error: ${error.message}`);
            return 0;
        }
    }

    // Delete entire group and all its bots
    async deleteGroup(groupId) {
        try {
            // Delete all bots in the group
            const botResult = await Bot.deleteMany({
                group_id: groupId
            });

            // Delete all events for the group
            const eventResult = await Event.deleteMany({
                group_id: groupId
            });

            console.log(`Deleted group ${groupId}: ${botResult.deletedCount} bots, ${eventResult.deletedCount} events`);
            return { success: true, botsDeleted: botResult.deletedCount, eventsDeleted: eventResult.deletedCount };
        } catch (error) {
            console.error(`deleteGroup error: ${error.message}`);
            return { success: false, message: error.message };
        }
    }

    // Delete individual bot
    async deleteBot(groupId, dvsaUsername) {
        try {
            // Delete the bot
            const botResult = await Bot.deleteOne({
                group_id: groupId,
                dvsa_username: dvsaUsername
            });

            // Delete all events for this bot
            const eventResult = await Event.deleteMany({
                group_id: groupId,
                dvsa_username: dvsaUsername
            });

            console.log(`Deleted bot ${groupId}/${dvsaUsername}: ${eventResult.deletedCount} events`);
            return { success: true, eventsDeleted: eventResult.deletedCount };
        } catch (error) {
            console.error(`deleteBot error: ${error.message}`);
            return { success: false, message: error.message };
        }
    }

    // ===== Common Settings Operations =====
    async getCommonSettings() {
        try {
            let settings = await CommonSettings.findOne();

            // If no settings exist, create default ones
            if (!settings) {
                settings = new CommonSettings({});
                await settings.save();
            }

            return settings;
        } catch (error) {
            console.error(`getCommonSettings error: ${error.message}`);
            return null;
        }
    }

    async updateCommonSettings(data) {
        try {
            const settings = await CommonSettings.findOneAndUpdate(
                {},
                {
                    jitter_min: data.jitter_min,
                    jitter_max: data.jitter_max,
                    max_clicks: data.max_clicks,
                    max_running_time: data.max_running_time,
                    cooldown_time: data.cooldown_time,
                    deadline_date: data.deadline_date,
                    updated_at: new Date()
                },
                { upsert: true, new: true }
            );
            return settings;
        } catch (error) {
            console.error(`updateCommonSettings error: ${error.message}`);
            throw error;
        }
    }

    // ===== Account Operations =====
    async createAccount(accountName, dvsaUsername, dvsaPassword = '') {
        try {
            const account = new Account({
                account_name: accountName,
                dvsa_username: dvsaUsername,
                dvsa_password: dvsaPassword
            });
            await account.save();
            return account;
        } catch (error) {
            console.error(`createAccount error: ${error.message}`);
            throw error;
        }
    }

    async getAllAccounts() {
        try {
            return await Account.find({}).sort({ account_name: 1 });
        } catch (error) {
            console.error(`getAllAccounts error: ${error.message}`);
            return [];
        }
    }

    async getAccount(accountId) {
        try {
            return await Account.findById(accountId);
        } catch (error) {
            console.error(`getAccount error: ${error.message}`);
            return null;
        }
    }

    async updateAccount(accountId, data) {
        try {
            const account = await Account.findByIdAndUpdate(
                accountId,
                {
                    account_name: data.account_name,
                    dvsa_username: data.dvsa_username,
                    dvsa_password: data.dvsa_password,
                    enabled: data.enabled,
                    updated_at: new Date()
                },
                { new: true }
            );
            return account;
        } catch (error) {
            console.error(`updateAccount error: ${error.message}`);
            throw error;
        }
    }

    async deleteAccount(accountId) {
        try {
            const result = await Account.deleteOne({ _id: accountId });
            return { success: result.deletedCount > 0 };
        } catch (error) {
            console.error(`deleteAccount error: ${error.message}`);
            return { success: false, message: error.message };
        }
    }

    // ===== Click Tracking Operations =====
    
    // Get UK timezone date string (YYYY-MM-DD)
    getUKDateString() {
        const now = new Date();
        const ukTime = new Date(now.toLocaleString("en-US", {timeZone: "Europe/London"}));
        return ukTime.toISOString().split('T')[0];
    }

    // Record a click for an account
    async recordClick(accountId, dvsaUsername, buttonType) {
        try {
            const today = this.getUKDateString();
            
            // Find or create today's click record
            let clickRecord = await DailyClick.findOne({ 
                account_id: accountId, 
                date: today 
            });
            
            if (!clickRecord) {
                clickRecord = new DailyClick({
                    account_id: accountId,
                    dvsa_username: dvsaUsername,
                    date: today,
                    clicks_today: 0,
                    button_breakdown: {
                        next_available: 0,
                        previous_available: 0,
                        next_week: 0,
                        previous_week: 0
                    }
                });
            }
            
            // Increment total clicks
            clickRecord.clicks_today++;
            
            // Increment button-specific clicks
            if (clickRecord.button_breakdown[buttonType] !== undefined) {
                clickRecord.button_breakdown[buttonType]++;
            }
            
            clickRecord.last_click_at = new Date();
            clickRecord.updated_at = new Date();
            
            await clickRecord.save();
            
            console.log(`Click recorded for ${dvsaUsername}: ${clickRecord.clicks_today} clicks today`);
            return clickRecord;
            
        } catch (error) {
            console.error(`recordClick error: ${error.message}`);
            throw error;
        }
    }

    // Get today's click stats for an account
    async getTodayClickStats(accountId) {
        try {
            const today = this.getUKDateString();
            const clickRecord = await DailyClick.findOne({ 
                account_id: accountId, 
                date: today 
            });
            
            if (!clickRecord) {
                return {
                    clicks_today: 0,
                    button_breakdown: {
                        next_available: 0,
                        previous_available: 0,
                        next_week: 0,
                        previous_week: 0
                    },
                    last_click_at: null
                };
            }
            
            return {
                clicks_today: clickRecord.clicks_today,
                button_breakdown: clickRecord.button_breakdown,
                last_click_at: clickRecord.last_click_at
            };
            
        } catch (error) {
            console.error(`getTodayClickStats error: ${error.message}`);
            return {
                clicks_today: 0,
                button_breakdown: {
                    next_available: 0,
                    previous_available: 0,
                    next_week: 0,
                    previous_week: 0
                },
                last_click_at: null
            };
        }
    }

    // Get all accounts with their click stats
    async getAllAccountsWithClickStats() {
        try {
            const accounts = await Account.find({}).sort({ account_name: 1 });
            
            const accountsWithStats = await Promise.all(accounts.map(async (account) => {
                const clickStats = await this.getTodayClickStats(account._id);
                return {
                    ...account.toObject(),
                    click_stats: clickStats
                };
            }));
            
            return accountsWithStats;
        } catch (error) {
            console.error(`getAllAccountsWithClickStats error: ${error.message}`);
            return [];
        }
    }

    // Clean up old click records (older than 30 days)
    async cleanupOldClickRecords() {
        try {
            const thirtyDaysAgo = new Date();
            thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
            const cutoffDate = thirtyDaysAgo.toISOString().split('T')[0];
            
            const result = await DailyClick.deleteMany({ 
                date: { $lt: cutoffDate } 
            });
            
            console.log(`Cleaned up ${result.deletedCount} old click records`);
            return result.deletedCount;
        } catch (error) {
            console.error(`cleanupOldClickRecords error: ${error.message}`);
            return 0;
        }
    }

    // ===== Bot Session Operations =====
    
    // Start a new bot session
    async startBotSession(accountId, dvsaUsername) {
        try {
            const session = new BotSession({
                account_id: accountId,
                dvsa_username: dvsaUsername,
                session_start: new Date(),
                status: 'running'
            });
            
            await session.save();
            console.log(`Bot session started for ${dvsaUsername}`);
            return session;
        } catch (error) {
            console.error(`startBotSession error: ${error.message}`);
            throw error;
        }
    }

    // End a bot session
    async endBotSession(accountId, clicksCount = 0) {
        try {
            const session = await BotSession.findOne({
                account_id: accountId,
                status: 'running'
            }).sort({ session_start: -1 });
            
            if (!session) {
                console.warn(`No running session found for account ${accountId}`);
                return null;
            }
            
            const sessionEnd = new Date();
            const durationMinutes = Math.round((sessionEnd - session.session_start) / (1000 * 60));
            
            session.session_end = sessionEnd;
            session.duration_minutes = durationMinutes;
            session.clicks_during_session = clicksCount;
            session.status = 'completed';
            session.updated_at = new Date();
            
            await session.save();
            console.log(`Bot session ended for ${session.dvsa_username}: ${durationMinutes} minutes, ${clicksCount} clicks`);
            return session;
        } catch (error) {
            console.error(`endBotSession error: ${error.message}`);
            throw error;
        }
    }


    // Get running session for account
    async getRunningSession(accountId) {
        try {
            return await BotSession.findOne({
                account_id: accountId,
                status: 'running'
            }).sort({ session_start: -1 });
        } catch (error) {
            console.error(`getRunningSession error: ${error.message}`);
            return null;
        }
    }

    async close() {
        try {
            await mongoose.connection.close();
            this.isConnected = false;
            console.log('MongoDB connection closed');
        } catch (error) {
            console.error(`MongoDB close error: ${error.message}`);
        }
    }
}

module.exports = DatabaseManager;
