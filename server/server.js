const path = require("path");
require("dotenv").config({path: path.join(__dirname, '../.env')});
const express = require('express');
const { createServer } = require('node:http');
const { Server } = require('socket.io');
const salesAssistantHandler = require('./open-ai/sales-assistant.js');
const crypto = require("crypto");


const app = express();
const server = createServer(app);

const io = new Server(server);


app.use(express.static('app'));
/*
app.get('/', (req, res) => {
    res.sendFile(join(__dirname, './app/index.html'));
});
*/
io.on('connection', async (socket) => {
    console.log('a user connected');
    
    socket.on('disconnect', () => {
      console.log('user disconnected');
    });

    try {
      let thread = await salesAssistantHandler.initateConversationWithOpenAiAssistant();
      console.log("Created Thread id", thread.id);
      socket.emit("welcome_message", {
        threadId: thread.id,
        text: `Hi! I'm your personal Node4 Sales Assistant AI. I can help you suggesting technologies that we provide for a specific problem. So ask away! \n Thread Id ${thread.id}`
      });
      
    } catch (e) {
      console.error(e);
    }
    

    socket.on('chat message', (queryObject) => {

      const {threadId, text} = queryObject;
      
      console.log('message: ' + text);
      socket.emit('chat message', text);
      
      console.log("SENDING MESSAGE", text);
      console.log("SENDING Thread", threadId);

      const logId = 'ailog_' + crypto.randomBytes(8).toString('hex');
      socket.emit('initiating_ai_chat_message', {logId: logId});
      
      salesAssistantHandler.sendMessageToThread(threadId, text, {
        onTextReceived: function(textRecived){
          socket.emit('partial_ai_chat_message', {logId: logId, text: textRecived});
        }
      })
      .then((e) => {
        console.log("MESSAGE COMPLETED");
        socket.emit('ai_chat_message_done', {logId: logId, text: e});
      })
      .catch((err) => {
        console.error(err);
        socket.emit('ai_chat_message_done', {logId: logId, text: "An error has occurred"});
      });
    });


});
  

server.listen(3000, () => {
  console.log('server running at http://localhost:3000');
});