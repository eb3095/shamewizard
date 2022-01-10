//
// Requires
//

const app = require('./package.json');

//
// Database
//

let db = {
    "users": {},
    "comments": []
}

//
// Configs
//

const config = require('./config/config.json');

//
// Includes
//

const snoowrap = require('snoowrap');
const snoostorm = require('snoostorm');
const fs = require('fs');

//
// Objects
//

const reddit = new snoowrap({
    userAgent: config.redditCredentials.userAgent.replace("{version}", `v${app.version}`),
    clientId: config.redditCredentials.appID,
    clientSecret: config.redditCredentials.appSecret,
    username: config.redditCredentials.username,
    password: config.redditCredentials.password
});


//
// Some people like to use console.log where it doesn't belong. Thanks for that.
//

console._log = console.log;
console.log = function () {
};


//
// Global Variables
//

let listener = null;
let replyQueue = [];
let lastReply = 0;
let requireDBSave = false;
let tracked = require('./config/tracked.json');


//
// Functions
//

function saveDB() {
    if (!requireDBSave) {
        setTimeout(saveDB, 1000);
        return;
    }
    fs.writeFileSync("./db.json", JSON.stringify(db, null, 2));
    requireDBSave = false;
    setTimeout(saveDB, 1000);
}

async function sleep(time) {
    await new Promise(r => setTimeout(r, time));
}

function log(string) {
    let date = new Date();
    let time = (date.getMonth() + 1) + "/" + (date.getDate() + 1) + "/" + date.getFullYear() + ` ${date.getHours()}:${date.getMinutes()}:${date.getSeconds()}`;
    let msg = `[${time}] ${string}`;
    console._log(msg);
    fs.appendFileSync('bot.log', `${msg}\n`);
}


function removeFromArray(object, array) {
    let index = array.indexOf(object);
    if (index !== -1) array.splice(index, 1);
}

async function reload() {
    tracked = require('./config/tracked.json');
    setTimeout(reload, 1000);
}

function shuffle(array) {
    let index = array.length;
    let temp;
    let rIndex;

    while (0 !== index) {
        rIndex = Math.floor(Math.random() * index);
        index--;
        temp = array[index];
        array[index] = array[rIndex];
        array[rIndex] = temp;
    }

    return array;
}


//
// Flow
//

function startListener() {
    log(`Listening for comments on: /r/all`);
    let options = {
        subreddit: "all",
        results: 500,
        pollTime: 1000
    };
    listener = new snoostorm.CommentStream(reddit, options);
    try {
        listener.on("item", comment => {

            // Debug line for data gathering
            if (config.debugMode) {
                log(`Comment Received: ${comment.id} Subreddit:/r/all Message: ${comment.body}`);
            }
            // End debug lines

            if (comment.author.name.toLowerCase() == config.redditCredentials.username.toLowerCase()) {
                return;
            }

            if (db.comments.includes(comment.id)) {
                return;
            }

            let details = [];
            for (let i = 0; i < tracked.length; i++) {
                let track = tracked[i];
                if (track.user.toLowerCase() == comment.author.name.toLowerCase()) {
                    details.push(track);
                }
            }

            if (details.length == 0) {
                return;
            }

            details = shuffle(details);
            db.comments.push(comment.id);
            requireDBSave = true;
            let event = {
                "comment": comment,
                "details": details[0]
            }
            replyQueue.push(event);
        });

        listener.on("error", function (err) {
            log(`Error encountered listening on /r/all, Error: ${err.message}`);
        });
    } catch (err) {
        log(`Error encountered listening on /r/all, Error: ${err.message}`);
    }
}

async function processReplyQueue() {
    for (let i = 0; i < replyQueue.lenth; i++) {
        let until = lastReply + (config.bot.cooldown * 1000);
        let time = new Date().getTime();
        if (until > time) {
            await sleep(until - time);
        }

        doReply(replyQueue[i]);
    }
    setTimeout(processReplyQueue, 1);
}

function doReply(event) {
    let date = new Date();
    let messageArr = config.bot.message;
    let messageRebuild = [];
    messageArr.forEach(line => {
        messageRebuild.push(line.replace("{{USERNAME}}", `/u/${event.comment.author.name}`).replace("{{URL}}", `https://reddit.com/${event.details.url}`).replace("{{COMMENT}}", `${event.details.comment}`))
    });
    let message = messageRebuild.join("\n\n");
    if (config.debugMode) {
        log("----------------------------------------------");
        log(`Would of replied to Comment: ${event.comment.id}`);
        log(`Subreddit: /r/all`);
        log(`Author: ${event.comment.author.name}`);
        log(`Message: ${event.comment.body}`);
        log(`Reply: ${message}`);
        log("----------------------------------------------");
        removeFromArray(event, replyQueue);
        lastReply = date.getTime();
    } else {
        event.comment.reply(message).then(result => {
            log("----------------------------------------------");
            log(`Replied to Comment: ${event.comment.id}`);
            log(`Author: ${event.comment.author.name}`);
            log(`Message: ${event.comment.body}`);
            log(`Reply: ${message}`);
            log("----------------------------------------------");
            removeFromArray(event, replyQueue);
            lastReply = date.getTime();
        }, err => {
            log(`Failed to reply to Comment: ${event.comment.id} Error: ${err.message}`);
        });
    }
}


//
// Entry Point
//

process.stdout.write('\033c');
console._log("Shame Wizard - An Shame Based Reddit Bot");
console._log(`Version: ${app.version}`);
console._log(`Description: ${app.description}`);
console._log(`Author: ${app.author}`);
console._log("------------------------------------\n");

log("Starting up");

log("Loading DB");
if (fs.existsSync('./db.json')) {
    let dbL = require('./db.json');
    Object.assign(db, dbL);
}

log("Setting up db manager");
setTimeout(saveDB, 1000);

log("Setting up tracker");
reload();

log("Starting Reply Processor");
setTimeout(processReplyQueue, 1000);

log("Setting up Listener");
startListener();
