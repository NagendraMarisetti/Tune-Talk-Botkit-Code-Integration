    var config      = require('./config.json');
    var jwt         = require("jwt-simple");
    const request   = require('request');
    const logger    = require('./logger')
    var cachedToken = null;
    /**
     * Retrieves a new access token for authentication.
     * Makes a POST request to the configured access token API.
     * 
     * @param {Function} callback - The callback function to handle the token retrieval process.
    */
    function getAccessToken(callback) {
        logger.infoWithFunction("Generating new access token",'Apis.js/getAccessToken')
        // Set up options for the POST request to the access token API
        var options = {
            'method': 'POST',
            'url': config.accessTokenApi,
            'headers': {}
        };
        // Make the request to retrieve the access token
        request(options, function (error, response) {
            if (error) {
                logger.errorWithFunction(`Error retrieving access token: ${error}`, 'Apis.js/getAccessToken');
            return callback(error);
        }
        // Parse the response body to extract the token
        var responseBody = JSON.parse(response.body);
        cachedToken = responseBody.data.token;  // Cache the retrieved token
        // Pass the token to the callback function
        callback(null, cachedToken);
    });
}


/**
 * Retrieves a valid token for authentication.
 * If a cached token is available, it uses that; otherwise, it retrieves a new token.
 * 
 * @param {Function} callback - The callback function to handle the token retrieval process.
*/
function getValidToken(callback) {

    if (cachedToken) {
         // If a cached token is available, use it and pass it to the callback function.
        logger.infoWithFunction('retrieving cached token for authentication.','Apis.js/getValidToken')
        return callback(null, cachedToken);
    } else {
        // If no cached token is available, retrieve a new token using getAccessToken function.
        logger.infoWithFunction('retrieving new token for authentication.','Apis.js/getValidToken')
        getAccessToken(callback);
    }
}


function getSignedJWTToken(botId) {
    
    var appId, apiKey, jwtAlgorithm, jwtExpiry;
    var defAlg = "HS256";

    if (config.credentials[botId]) {
        appId = config.credentials[botId].appId;
        apiKey = config.credentials[botId].apikey;
    } else {
        appId = config.credentials.appId;
        apiKey = config.credentials.apikey;
    }

    if (config.jwt[botId]) {
        jwtAlgorithm = config.jwt[botId].jwtAlgorithm;
        jwtExpiry = config.jwt[botId].jwtExpiry;
    } else {
        jwtAlgorithm = config.jwt.jwtAlgorithm;
        jwtExpiry = config.jwt.jwtExpiry;
    }

    return jwt.encode({ 
        appId: appId, 
        exp: Date.now()/1000 + (jwtExpiry || 60) //set the default expiry as 60 seconds
    }, apiKey, (jwtAlgorithm || defAlg));
}

    /**
     * Function to initiate a chat with a live agent.
     * Sends a POST request to the configured API to start a chat session.
     * 
     * @param {Object} data - The data required to initiate the chat.
     * @param {Object} requestBody - The request body containing necessary details for the chat initiation.
     * @param {Function} callback - The callback function to handle the response of the chat initiation process.
    */
    function initiateChat(data, requestBody,callback) {
        logger.infoWithFunction(`initiating Chat with agent : ${requestBody}` , 'Apis.js/initiateChat')
        let requestParams={
            "sessionId":requestBody.sessionId,
            "channelType":requestBody.channelType
        }
        gethistory(requestParams)
            .then(chatHistory => {
                var messages = chatHistory;

                const conversation = messages.map((message, index) => {
                  
                    const userType = message.type === 'incoming' ? 'client' : 'bot';
                    const timeFormatted = formatDate(message.createdOn);
                    
                    // Check if the message contains template code or whatsappId
                    let messageText = message.components[0].data.text;
                    if (messageText && (messageText.includes('"type":"template"') || messageText.includes('whatsappId'))) {
                        // messageText = message.tN;  
                        const parsedMessage = JSON.parse(messageText);
                        // Check if it's a WhatsApp message or a template
                        if (parsedMessage.interactive && parsedMessage.interactive.type === 'button') {
                            // Handle WhatsApp interactive buttons
                            const bodyText = parsedMessage.interactive.body.text;
                            const buttons = parsedMessage.interactive.action.buttons.map(button => button.reply.title).join(', ');

                            messageText = `${bodyText} Buttons: ${buttons}`;
                        } else if (parsedMessage.type === 'template' && parsedMessage.payload.template_type === 'button') {
                            // Handle template buttons
                            const bodyText = parsedMessage.payload.text;
                            const buttons = parsedMessage.payload.buttons.map(button => button.title).join(', ');

                            messageText = `${bodyText} Buttons: ${buttons}`;
                        }
                    }

                    return {
                        id: (index + 1).toString(),  // Assuming IDs start from 1 and increment
                        user: userType,
                        time: timeFormatted,
                        type: message.components[0].cT,  // Assuming the message type is in components
                        text: messageText,  // Message content
                        ...(userType === 'bot' && { status: '' })  // Add status if user is bot
                    };
                });
                
                // Set variables from requestBody
                chatInitiated=true
                visitorId=requestBody.from
                userId=requestBody.userId
                channelType=requestBody.channelType
                secured_session_id =requestBody.sessionId
                userName =requestBody.userName
            
                // Set up options for the POST request to initiate the chat
                var options = {
                    method: 'POST',
                    url: config.intiateChatApi,
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': config.authTokenLiveChat
                                    
                    },
                    body: JSON.stringify({
                        "appId": config.nubitelAppId,
                        "conversationId": secured_session_id,
                        "senderId": visitorId,
                        "extension": "8557",
                        "from": visitorId,
                        "fromName": userName,
                        "createdAt": new Date().toISOString(),
                        "conversation": conversation
                        })
                    };

                    // Make the request to initiate the chat
                request(options, function (error, response) {
                    if (error) {
                        logger.errorWithFunction(`Error initiating chat: ${error}`,'Apis.js/initiateChat' );
                        return callback(error);
                    }
                    
                    // Check if the response status code is not 201 (Created)
                    if (response.statusCode !== 201) {
                        const err = new Error(`Failed to initiate chat. Status code: ${response.statusCode}`);
                        logger.errorWithFunction(err,'Apis.js/initiateChat');
                        return callback(err);
                    }
                    try {
                        logger.infoWithFunction(`Chat initiated successfully | statuscode: ${response.statusCode}` , 'Apis.js/initiateChat');
                        return callback(null , response.statusCode);
                    } catch (parseError) {
                        logger.errorWithFunction(`Error parsing response body : ${parseError}`,'Apis.js/initiateChat');
                    }
                });
            })
            .catch(error => {
                logger.errorWithFunction(error,'Apis.js/initiateChat');
            });
    }

    /**
     * Function to add a message to an existing live chat.
     * Sends a POST request to the configured API to add a message to the chat session.
     * 
     * @param {Object} userRequest - The user request object containing necessary details for the message.
     * @param {Function} callback - The callback function to handle the response of the message addition process.
    */
    function addMessageToChat(userRequest,callback) {
        logger.infoWithFunction("Adding Message To Existing Chat for live chat agent",'Apis.js/addMessageToChat')

        // Set up options for the POST request to add the message to the chat
        var options = {
            method: 'POST',
            url: config.addMessageUrl,
            headers: {
                'Content-Type': 'application/json',
                'Authorization': config.authTokenLiveChat
            },
            body: JSON.stringify({
                "appId": config.nubitelAppId,
                "conversationId": userRequest.conversationId,
                "id": userRequest.requestId,
                "user": userRequest.name,
                "time": new Date().toISOString(),
                "text": userRequest.message,
                "type": "text"
            })
        };
        // Make the request to add the message to the chat
        request(options, function (error, response) {
            if (error) {
                logger.errorWithFunction(`Error adding message to chat: ${error}`, 'Apis.js/addMessageToChat');
                return callback(error);
            }
            // Check if the response status code is not 201 (Created)   
            if (response.statusCode !== 201) {
                const err = new Error(`Failed to add message to chat | Status code: ${response.statusCode}`);
                logger.errorWithFunction(err,'Apis.js/addMessageToChat');
                return callback(err);
            }
            try {
                logger.infoWithFunction("Message added to chat successfully",'Apis.js/addMessageToChat')
            } catch (parseError) {
                logger.errorWithFunction(`Error parsing response body: ${parseError}`, 'Apis.js/addMessageToChat');
                callback(parseError);
            }
        });
    } 

    /**
     * Function to send the bot response to WhatsApp users via the WhatsApp Business API (WABA).
     * 
     * @param {string} to - The WhatsApp user's phone number or ID.
     * @param {string} botResponseMessage - The message received from the bot.
     * @param {string} token - The authentication token for WhatsApp API.
     * @param {object} res - The HTTP response object to send the final response back to WhatsApp.
    */
    function sendResponseToWABA(to, botResponseMessage, token, res) {
        logger.infoWithFunction("Sending response to WABA user ",'Apis.js/sendResponseToWABA')

        let url, body;
        try {
            // Check if botResponseMessage is an object
            if(typeof(botResponseMessage) === 'object' || botResponseMessage.includes('whatsappId')){
                // Check if the string contains 'whatsappId'
                const containsWhatsAppId = botResponseMessage.includes('whatsappId');
                
                if(containsWhatsAppId){
                    
                    // Parse the JSON string
                    body =JSON.parse(botResponseMessage)
                    url = config.sendInteractiveMessageApi
                }
                else{
                    
                    body={
                        "whatsappId": config.whatsappId,
                        "to": to,
                        "message": JSON.stringify(botResponseMessage[0])
                    }
                    url = config.sendTextMessageApi
                }   
            }
            else{
                
                botResponseMessage =botResponseMessage.replace(/^\[System\]\s*/, '');
                body={
                    "whatsappId": config.whatsappId,
                    "to": to,
                    "message": botResponseMessage
                }
                url = config.sendTextMessageApi
            }
            
            const wabaOptions = {
                method: 'POST',
                url: url,
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify(body)
            };

            request(wabaOptions, function (error, response) {
                if (error) {
                    logger.errorWithFunction(`Error sending message to WABA: ${error}`, 'Apis.js/sendResponseToWABA');
                    if (!res.headersSent) {
                        logger.errorWithFunction(`Internal Server Issue ${error} | statuscode: 500`, 'Apis.js/sendResponseToWABA');
                        return res.status(500).send('Internal Server Error');
                    }
                    return;
                }
                if (response.statusCode === 401) {
                    logger.infoWithFunction('Token Expired. Regenerating token...', 'Apis.js/sendResponseToWABA')
                    cachedToken = null; // Clear the cached token
                    
                    // Avoid sending multiple responses
                    if (!res.headersSent) {
                        // Obtain access token and send response to WABA
                        api.getValidToken((err, newToken) => {
                            if (err) {
                                logger.errorWithFunction(`Internal Server Error | statuscode: 500`, 'Apis.js/sendResponseToWABA');
                                return res.status(500).send('Internal Server Error');
                            }
                            // If token retrieval is successful, send response to WABA
                            sendResponseToWABA(to, botResponseMessage, newToken, res);
                        });
                    }
                } else if (response.statusCode !== 200) {
                    logger.errorWithFunction(`WABA request failed with status code ${response.statusCode}`,'Apis.js/sendResponseToWABA');
                    if (!res.headersSent) {
                        logger.errorWithFunction(`Failed to send message to WABA | statuscode: ${response.statusCode}`,'Apis.js/sendResponseToWABA');
                        return res.status(response.statusCode).send('Failed to send message to WABA');
                    }
                } else {
                    logger.infoWithFunction('Response sent to WABA','Apis.js/sendResponseToWABA');
                    if (!res.headersSent) {
                        logger.infoWithFunction('Message processed and response sent to WABA successfully','Apis.js/sendResponseToWABA');
                    }
                }
            });
        } catch (generalError) {
            logger.errorWithFunction(`Unexpected error in sendResponseToWABA: ${generalError}`, 'Apis.js/sendResponseToWABA' );
            if (!res.headersSent) {
                logger.errorWithFunction(`Unexpected error occurred | statuscode: 500`, 'Apis.js/sendResponseToWABA' );
                res.status(500).send('Unexpected error occurred');
            }
        }
    }

    /**
     * Retrieves the chat history of a user using the getMessages API.
     *
     * @param {object} req - The request object containing query parameters.
     * @param {object} res- The response object used to send the result back to the client.
    */
    function gethistory(req, res) {
        
        const sessionId = req.sessionId;
        const channelType = req.channelType;

        const authToken = getSignedJWTToken(config.botId);
        
        logger.infoWithFunction(`Fetching Chat History of SessionId: ${sessionId}`,'Apis.js/gethistory' );

        var options = {
            method: 'POST',
            url: config.chatHistoryApi,
            headers: {
                'auth': authToken,  // Use the dynamically generated authToken
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                "skip": 0,
                "limit": config.historyLimit,
                "channelType": channelType,
                "forward": "true",
                "sessionId": [sessionId]
            })
        };

         // Return a promise to handle asynchronous behavior
        return new Promise((resolve, reject) => {
            request(options, function (error, response) {
                if (error) {
                    reject(error);  // Reject the promise in case of error
                } else if (response.statusCode !== 200) {
                    reject(`Request failed with status code ${response.statusCode}`);
                    logger.errorWithFunction(`Request failed with status code ${response.statusCode}`,'Apis.js/gethistory')
                } else {
                    try {
                        const resp = JSON.parse(response.body);  // Correctly parsing the response body
                        const messages = resp.messages;
                        resolve(messages);  // Resolve the promise with chat history
                    } catch (parseError) {
                        reject(parseError);  // Handle JSON parsing errors
                    }
                }
            });
        });
    }

    // Function to format date as "11 September 2024 14:48 UTC"
function formatDate(isoDateString) {
    const date = new Date(isoDateString);
    const options = {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
        hour: 'numeric',
        minute: 'numeric',
        timeZone: 'UTC',
        timeZoneName: 'short'
    };
    const formattedDate = date.toLocaleString('en-GB', options);
    return formattedDate.replace(' at ', ' ').replace(' GMT', ' UTC');
}

// Export the function to make it available for import in other files
module.exports = {
  getSignedJWTToken,
  getAccessToken,
  getValidToken,
  gethistory,
  addMessageToChat,
  initiateChat,
  sendResponseToWABA
}