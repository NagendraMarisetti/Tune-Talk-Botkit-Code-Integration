    var config         = require('./config.json');
    var botId          = config.credentials.botId;
    var botName        = config.credentials.botName;
    var sdk            = require("./lib/sdk");
    const request      = require('request');
    var _              = require('lodash');
    var api            = require('./Apis.js') 
    const logger         = require('./logger') 
    var conversationId = null  
    var _map           = {}; //used to store secure session ids //TODO: need to find clear map var
    var userDataMap    = {};//this will be use to store the data object for each user
    var chatSessions   = {};
    let sessionState   = {}; // Dictionary to track live chat session states
    
    /**
     * Handles incoming user requests and routes them appropriately based on the context.
     *
     * @param {string} requestId - The unique identifier for the request.
     * @param {object} data - The data object containing the message and context information.
     * @param {function} callback - The callback function to handle the response.
    */
    function on_user_message(requestId, data, callback) {
        // Log the incoming message to Log File along with function name.
        logger.infoWithFunction(`User Message: ${data.message}`,'SimpleConversationalBot.js/on_user_message');
        
        const isRTMChannel = (data && data.channel && data.channel.type === 'rtm') ||
        (data && data.channel && data.channel.channelInfos && data.channel.channelInfos.type === 'rtm');
        
        const isIVRChannel = (data && data.channel && data.channel.type === 'ivr') ||
        (data && data.channel && data.channel.channelInfos && data.channel.channelInfos.type === 'ivr');
        
        let username = 'Guest'; // Default value
        if (isRTMChannel) {
            username = data?.context?.session?.UserContext?.firstName || 'Guest';
        } else if (isIVRChannel) {
            username = data?.context?.session?.BotUserSession?.lastMessage?.messagePayload?.from?.userInfo?.firstName || 'Guest';
        }

        // Extract session ID from the data context
        let sessionId = data.context.session.BotUserSession.conversationSessionId;
        // If there is no agent transfer, forward the message to the bot
        if(!data.agent_transfer){
            logger.infoWithFunction("Agent Transfer Status is False - Forwarding MSG to Bot",'SimpleConversationalBot.js/on_user_message')
            sessionState[sessionId] = {
                sessionEndedByAgent: false
            };
            //Forward the message to bot
            return sdk.sendBotMessage(data, callback);
        } 
        // Handle agent transfer scenario
        else {
            // If agent transfer is true and the user is not mapped in _map, initiate agent transfer
            if(data.agent_transfer && !_map[data.channel.userId]){                
                logger.infoWithFunction("Agent Transfer is True , Chat Intiated False",'SimpleConversationalBot.js/on_user_message') 
                on_agent_transfer(requestId,data, callback);
            }
            // If agent transfer is true and the user is already mapped in _map, add the message to the chat
            else{
                logger.infoWithFunction("Agent Transfer is True, Chat Intiated True",'SimpleConversationalBot.js/on_user_message')
                userMessage=data.message;
                conversationId=data.channel.sessionId
                
                if(!conversationId){
                    conversationId =data.context.session.BotUserSession.conversationSessionId
                }
                // If both user message and conversation ID are available, add the message to the chat
                if(userMessage && conversationId ){
                    userRequest ={"conversationId" :conversationId ,"requestId":requestId ,"name":username,"message":userMessage}
                    api.addMessageToChat(userRequest, function(error, userMessage) {
                        if (error) {
                            logger.errorWithFunction(`Error Occured while adding message to chat: ${error}`,'SimpleConversationalBot.js/on_user_message')
                            return callback(error);
                        }
                        callback(null, userMessage);
                    });
                }
                else{
                    chatSessions[sessionId] = null;
                }
            }   
        } 
    }

    /**
     * Handles incoming bot responses and sends the appropriate response to the user.
     *
     * @param {string} requestId - The unique identifier for the request.
     * @param {object} data - The data object containing the bot message and context information.
     * @param {function} callback
    **/
    function on_bot_message(requestId, data, callback) {
        logger.infoWithFunction(`Bot Message: ${data.message}`,'SimpleConversationalBot.js/on_bot_message')

        conversationId=data.channel.sessionId
        if(!conversationId){
            conversationId =data.context.session.BotUserSession.conversationSessionId
        }
        if (data.message === 'I am closing our current conversation as I have not received any input from you. We can start over when you need.') {
            if(sessionState[conversationId] && sessionState[conversationId].sessionEndedByAgent){
                sdk.skipBotMessage(data, callback)
            }
            else{
                return sdk.sendUserMessage(data, callback);
            }
            delete sessionState[conversationId];
        }
        else{
            if(data.channel.type=='ivr' && data.context.previousNodeName=="ServiceNodeToCreateTicket"){
                var to=data.context.session.BotUserSession.lastMessage.messagePayload.from.id
                var botResponseMessage =data.message

                // For IVR channel, obtain access token and send response to WABA
                api.getValidToken((err, newToken) => {
                    if (err) {
                        logger.errorWithFunction(`Error while obtaining access token: ${err}`,'SimpleConversationalBot.js/on_bot_message')
                        return res.status(500).send('Internal Server Error');
                    }
                    // If token retrieval is successful, proceed to handle the message flow between WABA and Kore.ai
                    api.sendResponseToWABA(to, botResponseMessage, newToken, callback);
                });
                sdk.closeConversationSession(data, callback);
                sdk.resetBot(data, callback)

            }
            else{
                return sdk.sendUserMessage(data, callback);
            }
        }
        
    }

    /**
    * Function to receive WhatsApp messages and forward them to the bot using a Webhook.
    * 
    * @param {object} req - The HTTP request object containing the incoming WhatsApp message.
    * @param {object} res - The HTTP response object to send the response back to WhatsApp.
    */
    function getWhatsAppMessage(req, res) {
        logger.infoWithFunction("Getting Whatsapp Messages",'SimpleConversationalBot.js/getWhatsAppMessage')
        try {
            // Check if req.body and req.body.Json exist
            if (!req.body || !req.body.Json) {
                // console.error('No JSON payload found');
                logger.errorWithFunction(`No JSON payload found | statuscode: 400 | Bad Request`,'SimpleConversationalBot.js/getWhatsAppMessage');
                return res.status(400).send('Bad Request');
            }
            // Parse JSON payload
            const data = JSON.parse(req.body.Json);
            // Check if data.entry and data.entry[0] exist
            if (!data.entry || !data.entry[0] || !data.entry[0].changes) {
                // console.error('No changes found in the payload');
                logger.errorWithFunction('No changes found in the payload | statuscode: 400 | Bad Request','SimpleConversationalBot.js/getWhatsAppMessage');
                return res.status(400).send('Bad Request');
            }
            // Extract the changes array
            const changes = data.entry[0].changes;
            // Check if changes[0] and changes[0].value exist
            if (!changes[0] || !changes[0].value || !changes[0].value.messages) {
                logger.warnWithFunction('No messages found in the changes array | statuscode: 400 | Bad Request','SimpleConversationalBot.js/getWhatsAppMessage')
                return res.status(400).send('Bad Request');
            }
            // Extract the messages array from the first change
            const messages = changes[0].value.messages;
            const contacts =changes[0].value.contacts;
            // Check if messages array is not empty
            if (messages.length === 0) {
                // console.error('No messages found in the messages array');
                logger.errorWithFunction('No messages found in the messages array | statuscode: 400 | Bad Request','SimpleConversationalBot.js/getWhatsAppMessage');
                return res.status(400).send('Bad Request');
            }
            // Extract the recipient and message text
            const message = messages[0]?.text?.body 
                            || messages[0]?.interactive?.button_reply?.title 
                            || null;
            const to = messages[0].from || null;
            const name =contacts[0].profile.name ? contacts[0].profile.name :'unknown'
            
            // Validate extracted data
            if (!message || !to) {
                logger.errorWithFunction('Message or recipient data is missing | statuscode: 400 | Bad Request','SimpleConversationalBot.js/getWhatsAppMessage');
                return res.status(400).send('Bad Request');
            }

            // Retrieve a valid token required for WABA API authentication
            api.getValidToken((err, token) => {
                if (err) {
                    logger.errorWithFunction('Internal Server Error | statuscode: 500','SimpleConversationalBot.js/getWhatsAppMessage')
                    return res.status(500).send('Internal Server Error');
                }
                // If token retrieval is successful, proceed to handle the message flow between WABA and Kore.ai
                handleWABAtoKoreAndBack(to, message, name, token, res);
            });
            // Send success response
            logger.infoWithFunction('Message processed successfully | statuscode: 200','SimpleConversationalBot.js/getWhatsAppMessage')
            res.status(200).send('Message processed successfully');
        } catch (error) {
            // console.error('Error extracting message body:', error);
            logger.errorWithFunction(`statuscode: 500 | Error extracting message body: ${error}`,'SimpleConversationalBot.js/getWhatsAppMessage');
            res.status(500).send('Internal Server Error');
        }
    }

    /**
     * Function to forward WhatsApp messages to Kore.ai bot using a Webhook API,
     * consume the webhook response, and send the response back to the WhatsApp user.
     * 
     * @param {string} to - The WhatsApp user's phone number .
     * @param {string} message - The message received from the WhatsApp user.
     * @param {string} name - The name of the WhatsApp user.
     * @param {string} token - The authentication token for WhatsApp API.
     * @param {object} res - The HTTP response object to send the final response back to WhatsApp.
    */
    function handleWABAtoKoreAndBack(to, message,name,token, res) {
        try {
           // Step 1: Generate signed JWT token for authentication with Kore.ai
            const authToken = api.getSignedJWTToken(botId);

            // Step 2: Configure the options for the request to Kore.ai webhook
            const koreOptions = {
                method: 'POST',
                url: config.webhookUrl,
                headers: {
                    'Authorization': 'bearer '+authToken,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    "message": {
                        "type": "text",
                        "val": message
                    },
                    "from": {
                        "id": to,
                        "userInfo": {
                            "firstName": name,
                            "lastName": "",
                            "email": ""
                        }
                    }
                })
            };
            // Step 3: Send the message to Kore.ai webhook
            request(koreOptions, function (error, response, body) {
                if (error) {
                    // console.error('Error sending message to Kore.ai:', error);
                    logger.errorWithFunction(`Error sending message to Kore.ai: ${error}`,'SimpleConversationalBot.js/handleWABAtoKoreAndBack');
                    return;
                }
                if (response.statusCode !== 200) {
                    // console.error(`Kore.ai request failed with status code ${response.statusCode}`);
                    logger.warnWithFunction(`Kore.ai request failed with status code ${response.statusCode}`,'SimpleConversationalBot.js/handleWABAtoKoreAndBack');
                    return;
                }
                let koreResponse;
                
                try {
                    // Step 4: Parse the response from Kore.ai
                    koreResponse = JSON.parse(body);
                } catch (parseError) {
                    // console.error('Error parsing Kore.ai response:', parseError);
                    logger.errorWithFunction(`Error parsing Kore.ai response: ${parseError}`,'SimpleConversationalBot.js/handleWABAtoKoreAndBack');
                    return;
                }
                
                //Step 5: Extract the bot's response message
                koreResponse.data.forEach((message, index) => {
                    // Step 5: Get the bot response message from the 'val' field, or use a default response
                    const botResponseMessage = message.val || "Default response";
                    
                    // Step 6: Delay sending each message slightly to prevent overloading the API (optional)
                    setTimeout(() => {
                      // Step 7: Send the bot's response back to WhatsApp
                      api.sendResponseToWABA(to, botResponseMessage, token, res);
                    }, index * 1000); // Delay each message by 1 second
                  });

            });
        } catch (generalError) {
            // console.error('Unexpected error in handleWABAtoKoreAndBack:', generalError);
            logger.errorWithFunction(`statuscode: 500 | Unexpected error in handleWABAtoKoreAndBack: ${generalError}`,'SimpleConversationalBot.js/handleWABAtoKoreAndBack');
            res.status(500).send({ error: 'Unexpected error occurred' });
        }
    }

    /**
     * Handles the transfer of the conversation from the bot to a live agent on nubitel CX.
     *
     * @param {string} requestId - The unique identifier for the request.
     * @param {object} data - The data object containing the message and context information.
     * @param {function} callback - The callback function to handle the response.
    */
    function on_agent_transfer(requestId,data, callback) {
        // Extract session ID from the data
        let sessionId = data.context.session.BotUserSession.conversationSessionId;
        logger.infoWithFunction(`Agent Transfer sessionId : ${sessionId}`,'SimpleConversationalBot.js/on_agent_transfer')
        
        // Determine if the channel is RTM or IVR
        const isRTMChannel = (data && data.channel && data.channel.type === 'rtm') ||
        (data && data.channel && data.channel.channelInfos && data.channel.channelInfos.type === 'rtm');
        
        const isIVRChannel = (data && data.channel && data.channel.type === 'ivr') ||
        (data && data.channel && data.channel.channelInfos && data.channel.channelInfos.type === 'ivr');

        let from, userId;
        let botResponseMessage = "An Agent will be assigned to you shortly!!!";

        let username = 'Guest'; // Default value

        if(isRTMChannel){
            logger.infoWithFunction("request from RTM channel",'SimpleConversationalBot.js/on_agent_transfer')
            username = data?.context?.session?.UserContext?.firstName || 'Guest';
            // Send initial message to the user in RTM channel
            data.message=botResponseMessage;
            sdk.sendUserMessage(data, callback);
            
            var visitorId =data.context.session.BotUserSession.channels[0].from
            
            if(!visitorId){
                visitorId = _.get(data, 'channel.from');
            }
            // userDataMap[visitorId] = data;
            userDataMap[sessionId] = data;
            
            from=data.context.session.BotUserSession.channels[0].from
            
            userId = data.channel.userId ||
            (data.channel.channelInfos && data.channel.channelInfos.userId);
        }
        else if(isIVRChannel){
            logger.infoWithFunction("request from whatsapp channel",'SimpleConversationalBot.js/on_agent_transfer')
            from= data.context.session.BotUserSession.lastMessage.messagePayload.from.id
            username = data?.context?.session?.BotUserSession?.lastMessage?.messagePayload?.from?.userInfo?.firstName || 'Guest';
            userId = data.channel.userId ||
            (data.channel.channelInfos && data.channel.channelInfos.userId);
            
            userDataMap[sessionId] = data;
            sessionState[sessionId] = {
                mobileNumber: from
            };
            // For IVR channel, obtain access token and send response to WABA
            api.getValidToken((err, newToken) => {
                if (err) {
                    logger.errorWithFunction(`Internal Server Issue | statuscode: 500 | ${err}`,'SimpleConversationalBot.js/on_agent_transfer')
                    return res.status(500).send('Internal Server Error');
                }
                // If token retrieval is successful, proceed to handle the message flow between WABA and Kore.ai
                api.sendResponseToWABA(from, botResponseMessage, newToken, callback);
            });
        }
        // Prepare request body for initiating chat
        const requestBody = {
            message: data.message,
            from: from,
            userId: userId,
            sessionId: sessionId,
            userName: username,
            channelType: isRTMChannel ? 'rtm' : 'ivr'
        };

        // Initiate chat and handle the response
        api.initiateChat(data, requestBody,function(error, chatResponse) {
            if (error) {
                logger.errorWithFunction(error,'SimpleConversationalBot.js/on_agent_transfer')
                return callback(error);
            }
            // Initialize chat session with default values
            chatSessions[sessionId] = {
                chatInitiated: true,
                from: from,
                conversationId: sessionId
            };
            // Store session information in the _map object
            _map[userId] = {
                secured_session_id: sessionId,
                visitorId: from,
                userId: userId,
                last_message_id: 0
           };
        })
    }
    
    /**
     * Handles incoming messages from an agent and processes them based on the type of channel and message content.
     * 
     * @param {Object} req - The request object containing the message details.
     * @param {Object} res - The response object used to send responses back to the client.
     * @param {Function} callback - The callback function to handle the result of sending messages to the user.
    */
    async function getAgentMessage(req, res,callback){
        logger.infoWithFunction(`Received agent message: ${req.body}`,'SimpleConversationalBot.js/getAgentMessage')
        
        // Destructure the required fields from the request body
        const { conversationId, text: botResponseMessage } = req.body;
        
        try {
            
            // Validate if the required fields are present
            if (!conversationId || !botResponseMessage) {
                logger.errorWithFunction("Invalid request payload | statuscode:400",'SimpleConversationalBot.js/getAgentMessage');
                logger.errorWithFunction("Bad Request: Missing conversationId or message text",'SimpleConversationalBot.js/getAgentMessage');
                return res.status(400).send('Bad Request: Missing conversationId or message text');
            }

            const data = userDataMap[conversationId];
            const isChatEnded = botResponseMessage.includes('chat session ended');
            
            // Determine if the channel is RTM (Real-Time Messaging) and extract phone number from callId
            const isRTMChannel = (data && data.channel && data.channel.type === 'rtm') ||
            (data && data.channel && data.channel.channelInfos && data.channel.channelInfos.type === 'rtm');
           
            const userId =(data && data.channel && data.channel.userId) ||
            (data && data.channel && data.channel.channelInfos && data.channel.channelInfos.userId);

            if(sessionState[conversationId] && sessionState[conversationId].mobileNumber){
                var phoneNumber =sessionState[conversationId].mobileNumber
            }
            
             // Handle chat session end scenario
            if (isChatEnded){
                logger.infoWithFunction('chat closed','SimpleConversationalBot.js/getAgentMessage');
                closingMessage ="Chat Session Ended by Agent !";
                
                // For RTM channel, send the closing message and clean up session data
                if (isRTMChannel) {
                    data.message =closingMessage;
                    sdk.sendUserMessage(data, callback);
                    sdk.clearAgentSession(data);
                    delete userDataMap[conversationId];
                    delete _map[userId];

                    sessionState[conversationId] = {
                        sessionEndedByAgent: true
                    };
                    logger.infoWithFunction('Chat session ended successfully | statuscode: 200','SimpleConversationalBot.js/getAgentMessage')
                    return res.status(200).send('Chat session ended successfully');
                }
                else{
                    // For WhatsApp channel, send the closing message and clean up session data
                    api.getValidToken((err, newToken) => {
                        if (err) {
                            logger.errorWithFunction('Internal Server Error | statuscode: 500','SimpleConversationalBot.js/getAgentMessage')
                            return res.status(500).send('Internal Server Error');
                        }
                        // If token retrieval is successful, proceed to handle the message flow between WABA and Kore.ai
                        api.sendResponseToWABA(phoneNumber, closingMessage, newToken, res);
                    });
                    sdk.clearAgentSession(data);
                    delete userDataMap[conversationId];
                    delete _map[userId];
                    logger.infoWithFunction('Chat session ended successfully | statuscode: 200','SimpleConversationalBot.js/getAgentMessage')
                    return res.status(200).send('Chat session ended successfully');
                }
            }

            // Handle agent messages based on channel type
            if (isRTMChannel) {
                logger.infoWithFunction(`Sending agent message to Web Channel user ID: ${userId}`,'SimpleConversationalBot.js/getAgentMessage');
                data.message =botResponseMessage;
                if(!isChatEnded){
                    sdk.sendUserMessage(data, callback);
                    logger.infoWithFunction(`Agent message sent to Web Channel | statuscode: 200`,'SimpleConversationalBot.js/getAgentMessage');
                    return res.status(200).send('Agent message sent to Web Channel');
                }
            }
            else{
                logger.infoWithFunction(`Sending agent message to WhatsApp Channel user ${userId}`,'SimpleConversationalBot.js/getAgentMessage')
                
                api.getAccessToken((err, newToken) => {
                    if (err) {
                        logger.errorWithFunction(`Internal Server Error | statuscode: 500 | ${err}`,'SimpleConversationalBot.js/getAgentMessage')
                        return res.status(500).send('Internal Server Error');
                    }
                    if(!isChatEnded){
                        api.sendResponseToWABA(phoneNumber, botResponseMessage, newToken, res);
                        logger.infoWithFunction(`Agent message sent to WhatsApp Channel | statuscode: 200`,'SimpleConversationalBot.js/getAgentMessage');
                        return res.status(200).send('Agent message sent to WhatsApp Channel');
                    }
                });
            }
          } catch (error) {
            // Log any unexpected errors that occur during processing
            logger.errorWithFunction(`Internal Server Error | statuscode: 500 | ${error}`,'SimpleConversationalBot.js/getAgentMessage')
            return res.status(500).send('Internal Server Error');
        }
    }

    function on_event(requestId, data, callback) {
        console.log("on_event -->  Event : ", data.event);
        return callback(null, data);
    }

    function on_alert(requestId, data, callback) {
        console.log("on_alert -->  : ", data, data.message);
        return sdk.sendAlertMessage(data, callback);
    }

    module.exports = {
        botId   : botId,
        botName : botName,
        on_user_message: on_user_message,
        on_bot_message: on_bot_message,
        on_agent_transfer: on_agent_transfer,
        on_event: on_event,
        on_alert: on_alert,
        getWhatsAppMessage:getWhatsAppMessage,
        getAgentMessage:getAgentMessage,
        gethistory: api.gethistory
    };


