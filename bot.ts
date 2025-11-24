import { Bot } from "grammy";
import dotenv from "dotenv";
import fs from "fs";
import cron from "node-cron";

dotenv.config();

const token = process.env.BOT_TOKEN!;
const channelId = Number(process.env.CHANNEL_ID);

const bot = new Bot(token);

// Countdown config
const dataFile = "./countdown.json";

// Initialize data file
let data: {
    messageId?: number;
    startDate?: string;
    testCount?: number;
    testMessageId?: number;
} = {};
if (fs.existsSync(dataFile)) {
    data = JSON.parse(fs.readFileSync(dataFile, "utf-8"));
}

// Calculate days until next New Year
function getDaysUntilNewYear(): { daysPassed: number; totalDays: number } {
    const now = new Date();
    const currentYear = now.getFullYear();

    // Create date for January 1st of current year
    const jan1 = new Date(currentYear, 0, 1);

    // Create date for today at midnight
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    // Calculate difference in days
    const diffTime = today.getTime() - jan1.getTime();
    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));

    // Day of year is diffDays + 1 (because Jan 1 = day 1, not day 0)
    const dayOfYear = diffDays + 1;

    // Check if leap year
    const isLeapYear = (currentYear % 4 === 0 && currentYear % 100 !== 0) || (currentYear % 400 === 0);
    const totalDays = isLeapYear ? 366 : 365;

    console.log(`DEBUG: Today's date: ${today.toString()}`);
    console.log(`DEBUG: January 1: ${jan1.toString()}`);
    console.log(`DEBUG: Difference in days: ${diffDays}`);
    console.log(`DEBUG: Day of year (should be ~329 for Nov 24): ${dayOfYear}`);
    console.log(`DEBUG: Total days in ${currentYear}: ${totalDays}`);
    console.log(`DEBUG: Is leap year: ${isLeapYear}`);

    return { daysPassed: dayOfYear, totalDays };
}

// Helper: generate the 4-line countdown string with perfect alignment
function generateCountdown(daysPassed: number, totalDays: number) {
    const linesCount = 4;
    const lineLength = Math.ceil(totalDays / linesCount);

    let remainingFilled = daysPassed;
    const lines: string[] = [];

    for (let i = 0; i < linesCount; i++) {
        const fill = Math.min(remainingFilled, lineLength);
        const empty = lineLength - fill;
        // Using full-width block characters for perfect alignment
        // █ = filled (days passed), ░ = empty (days remaining)
        lines.push("█".repeat(fill) + "░".repeat(empty));
        remainingFilled -= fill;
    }

    const now = new Date();
    const daysRemaining = totalDays - daysPassed;
    const dateStr = now.toLocaleDateString("en-US", {
        year: "numeric",
        month: "long",
        day: "numeric"
    });

    // Wrap in monospace code block for 100% guaranteed alignment
    return (
        `📅 ${dateStr}\n\n` +
        "```\n" +
        lines.join("\n") +
        "\n```\n\n" +
        `✨ Days until 2026: ${daysRemaining}\n` +
        `📊 Progress: ${daysPassed}/${totalDays} days (${((daysPassed / totalDays) * 100).toFixed(1)}%)`
    );
}

// Function to send/update countdown
async function updateCountdown() {
    try {
        const { daysPassed, totalDays } = getDaysUntilNewYear();
        const countdownMessage = generateCountdown(daysPassed, totalDays);

        // If we already sent a message before, edit it
        if (data.messageId) {
            await bot.api.editMessageText(channelId, data.messageId, countdownMessage, {
                parse_mode: "Markdown"
            });
            console.log(`✅ Countdown updated! Day ${daysPassed}/${totalDays}`);
        } else {
            const sent = await bot.api.sendMessage(channelId, countdownMessage, {
                parse_mode: "Markdown"
            });
            data.messageId = sent.message_id;
            console.log(`✅ Countdown message created! Day ${daysPassed}/${totalDays}`);
        }

        fs.writeFileSync(dataFile, JSON.stringify(data, null, 2));
    } catch (error) {
        console.error("❌ Error updating countdown:", error);
    }
}

// Schedule daily update at 7:00 AM
// Format: "minute hour * * *"
// "0 7 * * *" = At 7:00 AM every day
cron.schedule("0 7 * * *", () => {
    console.log("⏰ Running scheduled countdown update at 7:00 AM");
    updateCountdown();
});

// Manual command to trigger update immediately
bot.command("update", async (ctx) => {
    await updateCountdown();
    await ctx.reply("✅ Countdown manually updated!");
});

// Command to reset (create new message)
bot.command("reset", async (ctx) => {
    data.messageId = undefined;
    fs.writeFileSync(dataFile, JSON.stringify(data, null, 2));
    await updateCountdown();
    await ctx.reply("🔄 Countdown reset and new message created!");
});

// Command to check current status
bot.command("status", async (ctx) => {
    const { daysPassed, totalDays } = getDaysUntilNewYear();
    const daysRemaining = totalDays - daysPassed;
    const percentage = ((daysPassed / totalDays) * 100).toFixed(1);

    await ctx.reply(
        `📊 Current Progress:\n` +
        `Days passed: ${daysPassed}/${totalDays}\n` +
        `Days until New Year: ${daysRemaining}\n` +
        `Progress: ${percentage}%\n\n` +
        `Next update: Tomorrow at 7:00 AM`
    );
});

// Command to test countdown display
bot.command("test", async (ctx) => {
    const { daysPassed, totalDays } = getDaysUntilNewYear();
    const countdownMessage = generateCountdown(daysPassed, totalDays);
    await ctx.reply(countdownMessage, { parse_mode: "Markdown" });
});

// Command to simulate daily progress (for testing)
bot.command("sendcountdown", async (ctx) => {
    try {
        const { daysPassed, totalDays } = getDaysUntilNewYear();

        // FORCE recalculation - always use current day as base if testCount seems wrong
        if (data.testCount === undefined || data.testCount < daysPassed) {
            console.log(`Resetting testCount from ${data.testCount} to current day ${daysPassed}`);
            data.testCount = daysPassed - 1; // -1 so when we increment it becomes current day
        }

        // Increment test counter by 1
        data.testCount += 1;

        // Make sure we don't exceed total days
        if (data.testCount > totalDays) {
            await ctx.reply(`⚠️ Already at maximum days (${totalDays})! Use /resettestcount to start over.`);
            return;
        }

        const countdownMessage = generateCountdown(data.testCount, totalDays);

        let success = false;
        let newMessageId = data.testMessageId;

        // Try to edit existing message first
        if (data.testMessageId) {
            try {
                await bot.api.editMessageText(channelId, data.testMessageId, countdownMessage, {
                    parse_mode: "Markdown"
                });
                console.log(`✅ Edited message ${data.testMessageId} in channel`);
                success = true;
            } catch (editError: any) {
                console.log(`⚠️ Could not edit message: ${editError.message}`);
                // Clear the old message ID since it's invalid
                data.testMessageId = undefined;
            }
        }

        // If edit failed or no message exists, create new one
        if (!success) {
            try {
                const sent = await bot.api.sendMessage(channelId, countdownMessage, {
                    parse_mode: "Markdown"
                });
                newMessageId = sent.message_id;
                console.log(`✅ Created new message ${sent.message_id} in channel`);
                success = true;
            } catch (sendError: any) {
                console.error(`❌ Could not send message: ${sendError.message}`);
                await ctx.reply(`❌ Failed to send to channel. Error: ${sendError.message}`);
                return;
            }
        }

        // Save the message ID
        data.testMessageId = newMessageId;
        fs.writeFileSync(dataFile, JSON.stringify(data, null, 2));

        await ctx.reply(
            `✅ Countdown updated in channel!\n` +
            `📊 Day ${data.testCount}/${totalDays} (${((data.testCount/totalDays)*100).toFixed(1)}%)\n` +
            `Message ID: ${newMessageId}`
        );
    } catch (error: any) {
        console.error("❌ Error in sendcountdown:", error);
        await ctx.reply(`❌ Error: ${error.message}`);
    }
});

// Command to reset test countdown
bot.command("resettestcount", async (ctx) => {
    const { daysPassed } = getDaysUntilNewYear();
    data.testCount = daysPassed; // Reset to current actual day
    data.testMessageId = undefined;
    fs.writeFileSync(dataFile, JSON.stringify(data, null, 2));
    await ctx.reply(`🔄 Test countdown reset to current day: ${daysPassed}`);
});

bot.start();
console.log("✅ Bot started successfully!");
console.log("⏰ Scheduled to update daily at 7:00 AM");
console.log("📝 Available commands:");
console.log("   /update - Manually update countdown now");
console.log("   /reset - Reset and create new message");
console.log("   /status - Check current progress");
console.log("   /test - Preview countdown without saving");
console.log("   /sendcountdown - Test mode: increment by 1 day each call");
console.log("   /resettestcount - Reset test counter to 0");