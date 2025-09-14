# Alpha Insurance: AI-Powered Outbound Policy Verification Agent

This project demonstrates a conversational AI agent built with Node.js, Twilio Voice, Twilio ConversationRelay, and Google Gemini. The agent's purpose is to make outbound calls to customers to verbally verify details for new auto insurance policies, ensuring accuracy and compliance.

## Features

- **AI-Powered Conversation:** Leverages Google Gemini for natural, script-driven policy verification.
- **Automated Outbound Calling:** Initiates calls programmatically via the Twilio Voice API.
- **Real-time Interaction:** Uses WebSockets (Twilio ConversationRelay) for low-latency voice communication.
- **Context Management:** Maintains conversation history and customer data for personalized interactions.
- **Post-Call Analytics:** Integrates with Twilio Intelligence to analyze call recordings for sentiment, topics, and performance, storing insights in an SQLite database.
- **Graceful Handoff:** Includes logic to connect to a human agent if needed.

## Architecture

1.  An API Client triggers the outbound call by sending a POST request to the Node.js Server's `/make-call` endpoint.
2.  The server uses the Twilio Voice API to create the call. Twilio calls the customer. Once answered, it fetches TwiML from the server's `/twiml` endpoint.
3.  The TwiML response initiates Twilio ConversationRelay, which establishes a WebSocket connection to the server's `/ws` endpoint.
4.  The server's WebSocket handler manages the live, bilingual conversation by sending prompts to the Google Gemini API.
5.  After the call, the Twilio Intelligence Service (configured in the console) automatically processes the call recording.
6.  The Intelligence Service sends the analysis results (sentiment, topic, score) to the server's `/analysis-complete` webhook.


## Setup and Installation

1.  **Clone the Repository:**
    ```bash
    git clone [https://github.com/Sean0418/Alpha-Insurance.git](https://github.com/Sean0418/Alpha-Insurance.git)
    cd Alpha-Insurance #Or start Git Bash in the cloned folder
    ```

2.  **Install Dependencies:**
    ```bash
    npm install
    ```

3.  **Create `.env` File:**
    Create a file named `.env` in the root of your project and populate it with your Twilio and Google API credentials.
    ```env
    GEMINI_API_KEY="YOUR_GOOGLE_GEMINI_API_KEY"
    TWILIO_ACCOUNT_SID="ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
    TWILIO_AUTH_TOKEN="your_twilio_auth_token"
    TWILIO_PHONE_NUMBER="+1xxxxxxxxxx" # Your Twilio phone number (e.g., +1234567890)
    NGROK_URL="[https://your-ngrok-url.ngrok-free.app](https://your-ngrok-url.ngrok-free.app)" # Your ngrok public URL
    VOICE_INTELLIGENCE_SERVICE_SID="ZSxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" # Your Twilio Voice Intelligence Service SID
    ```

4.  **Start Ngrok:**
    You'll need `ngrok` to expose your local server to the internet.
    ```bash
    ./ngrok http 8080
    ```
    Update `NGROK_URL` in your `.env` file with the HTTPS forwarding URL provided by `ngrok`.

5.  **Configure Twilio Webhooks & Intelligence Service:**

    * **Twilio Phone Number:** Configure your Twilio phone number's "A CALL COMES IN" webhook (under "Voice & Fax") to point to `https://your-ngrok-url.ngrok-free.app/twiml`.

    * **Twilio Intelligence Service:** This project uses Twilio's Conversational Intelligence for post-call analytics. This requires a one-time setup of an Intelligence Service and its Language Operators in your Twilio Console.

        **a. Create the Intelligence Service**
        * In the Twilio Console, navigate to **Develop > Explore products > Conversational Intelligence**.
        * Click **"Intelligence Services"**
        * Click **"Create new Service"**.
        * Give it a memorable **Friendly Name** (e.g., `Alpha Insurance Agent`) and click **Create**.

        **b. Add the Language Operators**
        * After creating the service, you will be on its configuration page. Click on **"Language Operators"** in the service's sub-menu.
        * You will add three operators one by one:

        -----

        **i. Sentiment Analysis Operator**

        * Find **Sentiment Analysis**.
        * Click **Add to service**.

        -----

        **ii. Topic Extraction Operator**
        * Click **Add a Language Operator** again.
        * For **Operator Type**, select **Generative Custom**.
        * Give it a **Unique Name**, for example: `topic_extraction`.
        * In the **Prompt** text box, paste the following:
            ```
            Identify the primary purpose of this verification call. Choose from: Policy Verified, Customer Had Questions, Verification Failed, or Call Incomplete.
            ```
        * Click the **Advanced Setting** Accordion
        * For **Output format**, select **JSON**.
        * In the **JSON Schema** text box that appears, paste the following:
            ```json
            {
              "type": "object",
              "properties": {
                "topic": {
                  "type": "string"
                }
              },
              "required": [
                "topic"
              ]
            }
            ```
        * Click **Save**.

        -----

        **iii. Agent Performance Score Operator**
        * Click **Add a Language Operator** one more time.
        * For **Operator Type**, select **Generative Custom**.
        * Give it a **Unique Name**, for example: `agent_performance_score`.
        * In the **Prompt** text box, paste the following:
            ```
            Rate the virtual agent's performance on a scale of 1-5 for conversational flow and adherence to the script's goal.
            ```
        * Click the **Advanced Setting** Accordion
        * For **Output format**, select **JSON**.
        * In the **JSON Schema** text box that appears, paste the following:
            ```json
            {
              "type": "object",
              "properties": {
                "performance_score": {
                  "type": "string"
                },
                "score_reasoning": {
                  "type": "string"
                }
              },
              "required": [
                "performance_score",
                "score_reasoning"
              ]
            }
            ```
        * Click **Save**.

        **c. Get the Service SID**
        * Navigate back to the **Intelligence Services** page for your new service.
        * Copy the **Service SID**
        * Paste this value into your `.env` file for the `VOICE_INTELLIGENCE_SERVICE_SID` variable.

        **d. Configure the Service**
        * On the same **Intelligence Services** page, click the name of your agent
        * Click on **Settings**, check **Enable data use option** and **Auto transcribe**
        * Click **Save**.
        * Ensure **Data logging** is enabled for the service on the **Intelligence Services** page
          
6.  **Run the Server:**
    ```bash
    node server.js
    ```

## Usage

Once the server is running, you can trigger an outbound call using an API client (like Postman or cURL) to your `/make-call` endpoint.

**Example Postman Request:**

* **Method:** `POST`
* **URL:** `https://your-ngrok-url.ngrok-free.app/make-call`
* **Headers:** `Content-Type: application/x-www-form-urlencoded`
* **Body (raw):**
    ```
    {
      customerNumber="+1234567890"  (replace with the actual customer's phone number to call)
    }
    ```

## Post-Call Analysis

After a call that was recorded concludes, the recording will automatically be processed by your configured Twilio Intelligence Service. The analysis results will be sent to the `/analysis-complete` endpoint and saved into the `calls.db` SQLite database.
