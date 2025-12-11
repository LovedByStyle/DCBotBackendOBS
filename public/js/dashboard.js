// WebSocket connection for real-time updates
let ws = null;
let reconnectTimeout = null;

// Initialize progress bars from data attributes
function initializeProgressBars() {
    document.querySelectorAll('.progress-fill[data-width]').forEach(fill => {
        const width = fill.getAttribute('data-width');
        console.log('Setting progress bar width to:', width);
        fill.style.width = width;
    });
}

// Reconnection with exponential backoff
let reconnectAttempts = 0;
const MAX_RECONNECT_DELAY = 30000; // Max 30 seconds
const BASE_RECONNECT_DELAY = 2000; // Start at 2 seconds

function connectWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}`;

    // ✅ CLEANUP OLD CONNECTION
    if (ws) {
        try {
            ws.close();
        } catch (e) {
            console.warn('Error closing old WebSocket:', e);
        }
        ws = null;
    }

    // Clear any existing reconnect timeout
    if (reconnectTimeout) {
        clearTimeout(reconnectTimeout);
        reconnectTimeout = null;
    }

    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
        console.log('Dashboard WebSocket connected');

        // Reset reconnection attempts on successful connection
        reconnectAttempts = 0;

        // Register as dashboard client
        ws.send(JSON.stringify({
            action: 'register_dashboard'
        }));

        // Fetch initial stats
        fetchAndUpdateStats();
    };

    ws.onmessage = (event) => {
        const data = JSON.parse(event.data);

        if (data.action === 'stats_update') {
            updateDashboard(data.stats);
            // Re-initialize progress bars after dynamic update
            initializeProgressBars();
        }
    };

    ws.onclose = () => {
        console.log('Dashboard WebSocket disconnected');

        // Exponential backoff: 2s, 4s, 8s, 16s, 30s (max)
        const delay = Math.min(
            BASE_RECONNECT_DELAY * Math.pow(2, reconnectAttempts),
            MAX_RECONNECT_DELAY
        );

        reconnectAttempts++;
        console.log(`Reconnecting in ${delay}ms (attempt #${reconnectAttempts})...`);

        reconnectTimeout = setTimeout(connectWebSocket, delay);
    };

    ws.onerror = (error) => {
        console.error('Dashboard WebSocket error:', error);
    };
}

async function fetchAndUpdateStats() {
    try {
        const response = await fetch('/api/stats');
        const data = await response.json();
        updateDashboard(data);
    } catch (error) {
        console.error('Failed to fetch stats:', error);
    }
}

function updateDashboard(data) {
    // Update summary stats
    document.querySelector('.stat-value:nth-child(1)').textContent = data.totalBots || 0;

    const activeBots = document.querySelectorAll('.stat-value')[1];
    if (activeBots) activeBots.textContent = data.activeBots || 0;

    const totalClicks = document.querySelectorAll('.stat-value')[2];
    if (totalClicks) totalClicks.textContent = (data.totalClicks || 0).toLocaleString();

    // Update groups
    updateGroups(data.groups);

    // Update logs sidebar
    updateLogsSidebar(data.groups);
}

function updateGroups(groups) {
    const groupsContainer = document.querySelector('.groups-container');
    if (!groupsContainer) return;

    if (groups.length === 0) {
        groupsContainer.innerHTML = '<div class="no-groups"><p>No groups registered yet. Start Chrome extension bots to begin monitoring.</p></div>';
        return;
    }

    // Update existing groups instead of regenerating HTML
    groups.forEach(group => {
        updateGroup(group);
    });
}

function updateGroup(group) {
    // Find existing group element
    const groupElement = document.querySelector(`[data-group-id="${group.group_id}"]`);
    if (!groupElement) {
        // Group doesn't exist, create it
        createGroupElement(group);
        return;
    }

    // Update bot count
    const botCount = groupElement.querySelector('.bot-count');
    if (botCount) {
        botCount.textContent = `${group.bot_count} bots`;
    }

    // Update start/stop button
    const groupActions = groupElement.querySelector('.group-actions');
    if (groupActions) {
        groupActions.innerHTML = `
            ${group.status === 'paused' ? 
                `<button class="btn btn-success group-action-btn" onclick="startGroup('${group.group_id}')">Start</button>` :
                `<button class="btn btn-warning group-action-btn" onclick="stopGroup('${group.group_id}')">Stop</button>`
            }
            <button class="btn btn-danger group-action-btn" onclick="deleteGroup('${group.group_id}')">Delete</button>
        `;
    }

    // Update each bot in the group
    group.bots.forEach(bot => {
        updateBot(bot, group.group_id);
    });
}

function updateBot(bot, groupId) {
    // Find existing bot element
    const botElement = document.querySelector(`[data-bot-id="${groupId}/${bot.dvsa_username}"]`);
    if (!botElement) {
        // Bot doesn't exist, create it
        createBotElement(bot, groupId);
        return;
    }

    // Update bot status
    const statusIcon = botElement.querySelector('.bot-status');
    if (statusIcon) {
        statusIcon.textContent = bot.status === 'active' ? '🟢' : '🔴';
        statusIcon.className = `bot-status ${bot.status}`;
    }

    // Update bot details
    const botDetails = botElement.querySelector('.bot-details');
    if (botDetails) {
        botDetails.innerHTML = `
            <span>Status: <strong>${bot.status}</strong></span>
            <span>Last action: ${bot.last_action || 'none'}</span>
            <span>Heartbeat: ${bot.heartbeat_age}s ago</span>
        `;
    }

    // Update clicks and progress
    const progressInfo = botElement.querySelector('.progress-info');
    if (progressInfo) {
        const progressPercent = ((bot.clicks || 0) / bot.clicks_limit * 100).toFixed(1);
        progressInfo.innerHTML = `
            <span>Clicks: <strong>${bot.clicks || 0}</strong> / ${bot.clicks_limit}</span>
            <span>Progress: ${progressPercent}%</span>
        `;
    }

    // Update progress bar
    const progressFill = botElement.querySelector('.progress-fill');
    if (progressFill) {
        const progressPercent = ((bot.clicks || 0) / bot.clicks_limit * 100).toFixed(1);
        progressFill.style.width = `${progressPercent}%`;
    }

    // Update button statistics
    const buttonStats = botElement.querySelectorAll('.button-stat');
    if (buttonStats.length === 4) {
        buttonStats[0].querySelector('.button-count').textContent = bot.button_clicks?.next_available || 0;
        buttonStats[1].querySelector('.button-count').textContent = bot.button_clicks?.previous_available || 0;
        buttonStats[2].querySelector('.button-count').textContent = bot.button_clicks?.next_week || 0;
        buttonStats[3].querySelector('.button-count').textContent = bot.button_clicks?.previous_week || 0;
    }
}

function createGroupElement(group) {
    const groupsContainer = document.querySelector('.groups-container');
    const groupHTML = `
        <div class="group-card" data-group-id="${group.group_id}">
            <div class="group-header">
                <div class="group-info">
                    <h2>${group.group_id}</h2>
                    <span class="bot-count">${group.bot_count} bots</span>
                </div>
                <div class="group-actions">
                    ${group.status === 'paused' ? 
                        `<button class="btn btn-success group-action-btn" onclick="startGroup('${group.group_id}')">Start</button>` :
                        `<button class="btn btn-warning group-action-btn" onclick="stopGroup('${group.group_id}')">Stop</button>`
                    }
                    <button class="btn btn-danger group-action-btn" onclick="deleteGroup('${group.group_id}')">Delete</button>
                </div>
            </div>
            <div class="bots-list">
                ${group.bots.map(bot => createBotHTML(bot, group.group_id)).join('')}
            </div>
        </div>
    `;
    groupsContainer.insertAdjacentHTML('beforeend', groupHTML);
}

function createBotElement(bot, groupId) {
    const groupElement = document.querySelector(`[data-group-id="${groupId}"] .bots-list`);
    if (!groupElement) return;
    
    const botHTML = createBotHTML(bot, groupId);
    groupElement.insertAdjacentHTML('beforeend', botHTML);
}

function createBotHTML(bot, groupId) {
    return `
        <div class="bot-item ${bot.status}" data-bot-id="${groupId}/${bot.dvsa_username}">
            <div class="bot-header">
                <div class="bot-info">
                    <div class="bot-name">
                        <strong>${bot.dvsa_username}</strong>
                        <span class="bot-status ${bot.status}">
                            ${bot.status === 'active' ? '🟢' : '🔴'}
                        </span>
                    </div>
                </div>
                <div class="bot-actions">
                    <button class="btn btn-danger btn-sm" onclick="deleteBot('${groupId}', '${bot.dvsa_username}')">
                        🗑️
                    </button>
                </div>
            </div>
            <div class="bot-details">
                <span>Status: <strong>${bot.status}</strong></span>
                <span>Last action: ${bot.last_action || 'none'}</span>
                <span>Heartbeat: ${bot.heartbeat_age}s ago</span>
            </div>
            <div class="bot-progress-section">
                <div class="progress-info">
                    <span>Clicks: <strong>${bot.clicks || 0}</strong> / ${bot.clicks_limit}</span>
                    <span>Progress: ${((bot.clicks || 0) / bot.clicks_limit * 100).toFixed(1)}%</span>
                </div>
                <div class="progress-bar">
                    <div class="progress-fill" style="width: ${((bot.clicks || 0) / bot.clicks_limit * 100).toFixed(1)}%"></div>
                </div>
            </div>
            <div class="button-stats-grid">
                <div class="button-stat">
                    <span class="button-label">Next Available</span>
                    <span class="button-count">${bot.button_clicks?.next_available || 0}</span>
                </div>
                <div class="button-stat">
                    <span class="button-label">Previous Available</span>
                    <span class="button-count">${bot.button_clicks?.previous_available || 0}</span>
                </div>
                <div class="button-stat">
                    <span class="button-label">Next Week</span>
                    <span class="button-count">${bot.button_clicks?.next_week || 0}</span>
                </div>
                <div class="button-stat">
                    <span class="button-label">Previous Week</span>
                    <span class="button-count">${bot.button_clicks?.previous_week || 0}</span>
                </div>
            </div>
        </div>
    `;
}

let currentSelectedGroup = null;
let groupsData = [];

function updateLogsSidebar(groups) {
    groupsData = groups;

    // Update group tabs
    const groupTabs = document.getElementById('group-tabs');
    if (groupTabs && groups.length > 0) {
        groupTabs.innerHTML = groups.map((group, index) => `
            <button class="group-tab ${index === 0 && !currentSelectedGroup ? 'active' : (currentSelectedGroup === group.group_id ? 'active' : '')}"
                    onclick="selectGroup('${group.group_id}')">
                ${group.group_id}
            </button>
        `).join('');
    }

    // If no group selected, select first group
    if (!currentSelectedGroup && groups.length > 0) {
        currentSelectedGroup = groups[0].group_id;
    }

    // Show/hide clear logs button based on group selection
    const clearLogsBtn = document.getElementById('clear-logs-btn');
    if (clearLogsBtn) {
        clearLogsBtn.style.display = currentSelectedGroup ? 'inline-block' : 'none';
    }

    // Update logs for selected group
    displayGroupLogs(currentSelectedGroup);
}

function selectGroup(groupId) {
    console.log('Selecting group:', groupId);
    currentSelectedGroup = groupId;
    
    // Update active tab
    const groupTabs = document.querySelectorAll('.group-tab');
    groupTabs.forEach(tab => {
        tab.classList.remove('active');
        if (tab.getAttribute('onclick').includes(`'${groupId}'`)) {
            tab.classList.add('active');
        }
    });
    
    displayGroupLogs(groupId);

    // Show clear logs button when a group is selected
    const clearLogsBtn = document.getElementById('clear-logs-btn');
    if (clearLogsBtn) {
        clearLogsBtn.style.display = groupId ? 'inline-block' : 'none';
    }
}

function displayGroupLogs(groupId) {
    console.log('Displaying logs for group:', groupId);
    console.log('Available groups:', groupsData.map(g => g.group_id));
    
    const logsSidebarContent = document.getElementById('logs-sidebar-content');
    if (!logsSidebarContent) {
        console.log('Logs sidebar content not found');
        return;
    }

    // Find the selected group
    const selectedGroup = groupsData.find(g => g.group_id === groupId);
    console.log('Selected group:', selectedGroup);
    
    if (!selectedGroup) {
        console.log('Group not found in groupsData');
        logsSidebarContent.innerHTML = '<div class="log-item"><span class="log-message">Group not found</span></div>';
        return;
    }
    
    if (!selectedGroup.logs || selectedGroup.logs.length === 0) {
        console.log('No logs for this group');
        logsSidebarContent.innerHTML = '<div class="log-item"><span class="log-message">No activity logs yet</span></div>';
        return;
    }

    // Sort logs by timestamp (newest first)
    const sortedLogs = [...selectedGroup.logs].sort((a, b) => b.timestamp - a.timestamp);

    logsSidebarContent.innerHTML = sortedLogs.map(log => {
        const date = new Date(log.timestamp * 1000);
        const timeStr = date.toLocaleTimeString();
        return `
            <div class="log-item ${log.event_type}">
                <div>
                    <span class="log-time">${timeStr}</span>
                    <span class="log-bot">${log.dvsa_username || 'system'}</span>
                </div>
                <div class="log-message">${log.message}</div>
            </div>
        `;
    }).join('');

    // Auto-scroll to top (newest logs)
    logsSidebarContent.scrollTop = 0;
}

// Connect WebSocket on page load
connectWebSocket();

// Start group function
async function startGroup(groupId) {

    try {
        const response = await fetch(`/api/group/${groupId}/resume`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            }
        });

        const data = await response.json();

        if (data.success) {
            showNotification('✅ ' + data.message, 'success');
            fetchAndUpdateStats(); // Update immediately
        } else {
            showNotification('❌ ' + data.message, 'error');
        }
    } catch (error) {
        showNotification('❌ Error: ' + error.message, 'error');
    }
}

// Stop group function
async function stopGroup(groupId) {

    try {
        const response = await fetch(`/api/group/${groupId}/pause`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            }
        });

        const data = await response.json();

        if (data.success) {
            showNotification('✅ ' + data.message, 'success');
            fetchAndUpdateStats(); // Update immediately
        } else {
            showNotification('❌ ' + data.message, 'error');
        }
    } catch (error) {
        showNotification('❌ Error: ' + error.message, 'error');
    }
}

// Delete group function
async function deleteGroup(groupId) {

    try {
        const response = await fetch(`/api/group/${groupId}/delete`, {
            method: 'DELETE',
            headers: {
                'Content-Type': 'application/json'
            }
        });

        const data = await response.json();

        if (data.success) {
            showNotification('✅ ' + data.message, 'success');
            fetchAndUpdateStats(); // Update immediately
        } else {
            showNotification('❌ ' + data.message, 'error');
        }
    } catch (error) {
        showNotification('❌ Error: ' + error.message, 'error');
    }
}

// Delete bot function
async function deleteBot(groupId, dvsaUsername) {

    try {
        const response = await fetch(`/api/bot/${groupId}/${dvsaUsername}/delete`, {
            method: 'DELETE',
            headers: {
                'Content-Type': 'application/json'
            }
        });

        const data = await response.json();

        if (data.success) {
            showNotification('✅ ' + data.message, 'success');
            fetchAndUpdateStats(); // Update immediately
        } else {
            showNotification('❌ ' + data.message, 'error');
        }
    } catch (error) {
        showNotification('❌ Error: ' + error.message, 'error');
    }
}

// Manual click function
async function manualClick(groupId, dvsaUsername) {
    try {
        const response = await fetch(`/api/bot/${groupId}/${dvsaUsername}/click`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            }
        });

        const data = await response.json();

        if (data.success) {
            showNotification('✅ ' + data.message, 'success');
            fetchAndUpdateStats(); // Update immediately
        } else {
            showNotification('❌ ' + data.message, 'error');
        }
    } catch (error) {
        showNotification('❌ Error: ' + error.message, 'error');
    }
}

// Clear group logs function
async function clearGroupLogs() {
    if (!currentSelectedGroup) {
        showNotification('❌ No group selected', 'error');
        return;
    }

    try {
        const response = await fetch(`/api/group/${currentSelectedGroup}/clear-logs`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            }
        });

        const data = await response.json();

        if (data.success) {
            showNotification('✅ ' + data.message, 'success');
            fetchAndUpdateStats(); // Refresh to show empty logs
        } else {
            showNotification('❌ ' + data.message, 'error');
        }
    } catch (error) {
        showNotification('❌ Error: ' + error.message, 'error');
    }
}

// Show notification
function showNotification(message, type) {
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    notification.textContent = message;
    notification.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        padding: 15px 25px;
        background: ${type === 'success' ? '#48bb78' : '#f56565'};
        color: white;
        border-radius: 8px;
        font-weight: 600;
        box-shadow: 0 4px 12px rgba(0,0,0,0.15);
        z-index: 1000;
        animation: slideIn 0.3s ease;
    `;

    document.body.appendChild(notification);

    setTimeout(() => {
        notification.style.animation = 'slideOut 0.3s ease';
        setTimeout(() => notification.remove(), 300);
    }, 3000);
}

// Add CSS animations
const style = document.createElement('style');
style.textContent = `
    @keyframes slideIn {
        from {
            transform: translateX(400px);
            opacity: 0;
        }
        to {
            transform: translateX(0);
            opacity: 1;
        }
    }

    @keyframes slideOut {
        from {
            transform: translateX(0);
            opacity: 1;
        }
        to {
            transform: translateX(400px);
            opacity: 0;
        }
    }
`;
document.head.appendChild(style);

// Initialize progress bars when page loads
document.addEventListener('DOMContentLoaded', function() {
    initializeProgressBars();
});
