import Fastify from "fastify";
import fastifyWs from "@fastify/websocket";
import fastifyFormBody from "@fastify/formbody";
import dotenv from "dotenv";
import { GoogleGenerativeAI } from "@google/generative-ai";
import twilio from "twilio";
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';

dotenv.config();

// --- Language Configuration ---
const LANGUAGE = 'ENGLISH'; // Change to 'TAGLISH' to switch the agent's language

// --- Hardcoded Call Scripts ---
const mainScript_EN = [
    { "Process": "Opening", "Line to say": "Hi, may I speak with [customer name]? This is [agent name] from Alpha Insurance. Is this a good time to talk?" },
    { "Process": "Purpose of Call", "Line to say": "Great! I'm calling to finalize some details for your new auto insurance policy. I just need to confirm a few things with you, this will only take a moment." },
    { "Process": "Verification", "Line to say": "For security, can you please verify your full name and date of birth?" },
    { "Process": "Confirmation of Details", "Line to say": "Thank you. I have your address listed as [customer address]. Is that correct?" },
    { "Process": "Vehicle Information", "Line to say": "Okay, and the vehicle we are insuring is a [vehicle year, make, model], correct?" },
    { "Process": "Closing", "Line to say": "Excellent. Your policy is now active. You'll receive a confirmation email with all the details shortly. Thank you for choosing Alpha Insurance. Have a great day!" },
    { "Process": "Handoff", "Line to say": "I understand. Let me connect you to one of our human agents who can better assist you. Please hold." }
];
const faq_EN = [
    { "Question": "What is the name of your company?", "Answer": "I'm from Alpha Insurance." },
    { "Question": "Why are you calling me?", "Answer": "I'm calling to finalize some details for your new auto insurance policy to make sure everything is accurate." },
];
const mainScript_TG = [
    { "Process": "Opening", "Line to say": "Hi, pwede ko po bang makausap si [customer name]? Ako po si [agent name] from Alpha Insurance. Magandang oras po ba para makipag-usap?" },
    { "Process": "Purpose of Call", "Line to say": "Salamat po! Tumatawag po ako para i-finalize ang ilang detalye para sa bago ninyong auto insurance policy. May ilang bagay lang po akong kailangang i-confirm, sandali lang po ito." },
    { "Process": "Verification", "Line to say": "Para po sa inyong security, pwede niyo po bang i-verify ang inyong buong pangalan at birthday?" },
    { "Process": "Confirmation of Details", "Line to say": "Maraming salamat. Ang address niyo po na naka-lista sa amin ay [customer address]. Tama po ba ito?" },
    { "Process": "Vehicle Information", "Line to say": "Okay po, at ang sasakyan na ating ini-insure ay isang [vehicle year, make, model], tama po ba?" },
    { "Process": "Closing", "Line to say": "Excellent. Active na po ang inyong policy. Makakatanggap po kayo ng confirmation email na may kumpletong detalye. Maraming salamat sa pagpili sa Alpha Insurance. Have a great day po!" },
    { "Process": "Handoff", "Line to say": "Naiintindihan ko po. Sandali lang po at ikokonekta kita sa isa sa aming mga human agent para mas matulungan ka nila. Please hold." }
];
const faq_TG = [
    { "Question": "What is the name of your company?", "Answer": "Mula po ako sa Alpha Insurance." },
    { "Question": "Why are you calling me?", "Answer": "Tumatawag po ako para i-finalize ang mga detalye para sa bago ninyong auto insurance policy, para masigurado na tama po ang lahat ng impormasyon." },
];

const mainScript = LANGUAGE === 'TAGLISH' ? mainScript_TG : mainScript_EN;
const faq = LANGUAGE === 'TAGLISH' ? faq_TG : faq_EN;
console.log(`Scripts are hardcoded and ready. Active language: ${LANGUAGE}`);

// --- Sample Customer Data ---
const currentCustomer = {
    name: "Juan dela Cruz",
    address: "123 Rizal Street, Manila",
    vehicleYear: "2023",
    vehicleMake: "Toyota",
    vehicleModel: "Vios",
};
const agentName = "Alex";

// --- Database Variable ---
let db;

// --- Global Constants & Clients ---
const PORT = process.env.PORT || 8080;
const DOMAIN = process.env.NGROK_URL;
const WS_URL = `wss://${DOMAIN}/ws`;
const SYSTEM_PROMPT =
  `You are a conversational AI agent for Alpha Insurance. Your single task is to guide a customer through a policy verification script by calling the 'continueConversation' tool.
  - You have a 'mainScript' and an 'faq' to help you decide what to say.
  - You MUST use the provided customer data to replace placeholders in the script like [customer name]. This is your most important task.
  - Based on the user's response and conversation history, determine the most logical response and the next process from the mainScript.
  - You MUST call the 'continueConversation' tool with the personalized 'responseToUser' and the correct 'nextProcess'. Do not respond with text.`;
const sessions = new Map();
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
const tools = {
  functionDeclarations: [
    {
      name: "continueConversation",
      description: "Call this tool to provide the agent's next line and the next conversational process.",
      parameters: {
        type: "OBJECT",
        properties: {
          responseToUser: { type: "STRING", description: "The exact, personalized sentence the agent should say to the user." },
          nextProcess: { type: "STRING", description: "The name of the next process from the mainScript." },
        },
        required: ["responseToUser", "nextProcess"],
      },
    },
  ],
};
const modelWithTools = genAI.getGenerativeModel({ model: "gemini-1.5-flash", tools: tools });

// --- Server Setup ---
const fastify = Fastify();
fastify.register(fastifyWs);
fastify.register(fastifyFormBody);

// --- HTTP Routes ---
fastify.all("/twiml", async (request, reply) => {
    const firstStep = mainScript.find(step => step.Process === 'Opening');
    let firstLine = firstStep ? firstStep['Line to say'] : "Hello, this is Alpha Insurance.";
    // Manually replace placeholders for the very first line
    firstLine = firstLine.replace('[customer name]', currentCustomer.name).replace('[agent name]', agentName);
    
    const twimlResponse = `<?xml version="1.0" encoding="UTF-8"?>
    <Response>
      <Connect>
        <ConversationRelay url="${WS_URL}" welcomeGreeting="${firstLine}" />
      </Connect>
    </Response>`;
    reply.type("text/xml").send(twimlResponse);
});

fastify.post("/make-call", async (request, reply) => {
    const { customerNumber } = request.body;
    if (!customerNumber) {
        return reply.status(400).send({ error: 'customerNumber is required' });
    }
    try {
        console.log(`Initiating call to ${customerNumber}`);
        await twilioClient.calls.create({
            to: customerNumber,
            from: process.env.TWILIO_PHONE_NUMBER,
            url: `https://${DOMAIN}/twiml`,
            record: true,
            recordingStatusCallback: `https://${DOMAIN}/recording-complete`
        });
        reply.send({ message: `Call initiated to ${customerNumber}` });
    } catch (error) {
        console.error("Error initiating call:", error);
        reply.status(500).send({ error: 'Failed to initiate call' });
    }
});

fastify.post("/recording-complete", async (request, reply) => {
    const recordingSid = request.body.RecordingSid;
    if (recordingSid) {
        try {
            console.log(`Submitting analysis job for Recording SID: ${recordingSid}`);

            // This API call creates the custom transcript with your operators
            await twilioClient.intelligence.v2.transcripts.create({
                serviceSid: process.env.VOICE_INTELLIGENCE_SERVICE_SID,
                recordingSid: recordingSid,
                channel: 'customer',
                statusCallback: `https://${DOMAIN}/analysis-complete`,
                statusCallbackMethod: 'POST'
            });

            console.log("Analysis job submitted successfully.");
        } catch (error) {
            console.error("Error submitting analysis job:", error);
        }
    }
    reply.status(200).send();
});

// --- WebSocket Handler ---
fastify.register(async function (fastify) {
    fastify.get("/ws", { websocket: true }, (ws, req) => {
        ws.on("message", async (data) => {
            const message = JSON.parse(data);
            switch (message.type) {
                case "setup": {
                    const callSid = message.callSid;
                    console.log("Setup for call:", callSid);
                    ws.callSid = callSid;
                    sessions.set(callSid, { history: [], currentProcess: "Opening" });
                    break;
                }

                case "prompt": {
                    const sessionState = sessions.get(ws.callSid);

                    const userResponse = message.voicePrompt;
                    console.log(`Processing prompt: "${userResponse}"`);
                    try {
                        const richPrompt = `
                        System Instructions: ${SYSTEM_PROMPT}
                        Main Script: ${JSON.stringify(mainScript)}
                        FAQ: ${JSON.stringify(faq)}
                        Conversation History: ${JSON.stringify(sessionState.history)}
                        Customer Data: ${JSON.stringify(currentCustomer)}
                        Agent Name: ${agentName}
                        Current Process: "${sessionState.currentProcess}"
                        Customer's Latest Response: "${userResponse}"
                        Task: Adhere to all rules and generate the next JSON response.`;
                        
                        const chat = modelWithTools.startChat({history: sessionState.history});
                        const result = await chat.sendMessage(richPrompt);
                        const call = result.response.functionCalls()?.[0];

                        if (call?.name === 'continueConversation') {
                            const { responseToUser, nextProcess } = call.args;

                            sessionState.history.push({ role: "user", parts: [{ text: userResponse }] });
                            sessionState.history.push({ role: "model", parts: [{ functionCall: call }] });
                            sessionState.currentProcess = nextProcess;

                            const isClosing = (nextProcess === 'Closing' || nextProcess === 'Handoff');
                            ws.send(JSON.stringify({ type: "text", token: responseToUser, last: isClosing }));
                            console.log(`AI Response: "${responseToUser}", Next Process: ${nextProcess}`);
                        } else {
                            throw new Error("AI did not call the expected function. Response: " + result.response.text());
                        }
                    } catch (error) {
                        console.error("Error in prompt processing:", error);
                        ws.send(JSON.stringify({ type: "text", token: "I'm sorry, I encountered a system error. Please try again.", last: true }));
                    }
                    break;
                }

                case "interrupt": {
                    console.log("Handling interruption.");
                    const utterance = message.utteranceUntilInterrupt;
                    const sessionState = sessions.get(ws.callSid);
                    
                    if (sessionState && sessionState.history.length > 0) {
                        const lastMessageIndex = sessionState.history.length - 1;
                        const lastMessage = sessionState.history[lastMessageIndex];
                        
                        if (lastMessage.role === 'model' && lastMessage.parts[0].functionCall) {
                            // This is complex to fix perfectly, but for now, we can log it
                            console.log(`Interruption occurred after AI decided to speak. Spoken part: "${utterance}"`);
                        }
                    }
                    break;
                }

                default: {
                    console.warn("Unknown message type received:", message.type);
                    break;
                }
            }
        });
        ws.on("close", () => {
            console.log("WebSocket connection closed");
            if (ws.callSid) {
                sessions.delete(ws.callSid);
                console.log(`Session for call ${ws.callSid} cleaned up.`);
            }
        });
    });
});

// --- Server Start ---
(async () => {
    try {
        db = await open({ filename: './calls.db', driver: sqlite3.Database });
        await db.exec(`CREATE TABLE IF NOT EXISTS calls (call_sid TEXT PRIMARY KEY, topic TEXT, sentiment TEXT, performance_score TEXT);`);
        console.log('Database is ready.');
        await fastify.listen({ port: PORT });
        console.log(`Server running at http://localhost:${PORT}`);
    } catch (err) {
        fastify.log.error(err);
        process.exit(1);
    }
})();