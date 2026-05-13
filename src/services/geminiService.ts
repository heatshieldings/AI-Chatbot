import { GoogleGenAI, GenerateContentResponse } from "@google/genai";

const WEBSITE_URL = "https://heatshieldings.com";

export interface Message {
  role: 'user' | 'model';
  text: string;
  sources?: string[];
}

export async function getGreeting(): Promise<string> {
  const apiKey = import.meta.env.VITE_GEMINI_API_KEY || (typeof process !== 'undefined' ? process.env.GEMINI_API_KEY : undefined);
  const defaultGreeting = "Hallo! Ik ben je HeatShieldings assistent. Hoe kan ik je vandaag helpen bij het vinden van de juiste thermische bescherming voor jouw project?";
  
  if (!apiKey) {
    return defaultGreeting;
  }

  const ai = new GoogleGenAI({ apiKey });
  const browserLang = typeof navigator !== 'undefined' ? navigator.language : 'nl';
  
  if (browserLang.startsWith('nl')) {
    return defaultGreeting;
  }

  try {
    const translationPromise = ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: [{ role: 'user', parts: [{ text: `Translate this greeting into ${browserLang}: "${defaultGreeting}"` }] }],
      config: {
        systemInstruction: "You are a helpful translator. Only return the translated text, nothing else.",
      },
    });

    const timeoutPromise = new Promise<null>((_, reject) => 
      setTimeout(() => reject(new Error("Translation timeout")), 3000)
    );

    const response = await Promise.race([translationPromise, timeoutPromise]) as GenerateContentResponse | null;

    return response?.text || defaultGreeting;
  } catch (error) {
    console.error("Greeting Translation Error:", error);
    return defaultGreeting;
  }
}

export async function getChatResponse(message: string, history: Message[]): Promise<Message> {
  const apiKey = import.meta.env.VITE_GEMINI_API_KEY || (typeof process !== 'undefined' ? process.env.GEMINI_API_KEY : undefined);
  
  if (!apiKey) {
    console.error("GEMINI_API_KEY is missing!");
    return {
      role: 'model',
      text: "API Key is missing. Please contact administrator."
    };
  }

  const ai = new GoogleGenAI({ apiKey });
  const browserLang = typeof navigator !== 'undefined' ? navigator.language : 'en';
  
  console.log("Requesting chat response for:", message);

  const contents = history.map(msg => ({
    role: msg.role,
    parts: [{ text: msg.text }]
  }));
  
  const systemInstruction = `You are a helpful product assistant for HeatShieldings.com. 
        Your goal is to answer questions about products found on the website.
        ALWAYS use the provided website context from ${WEBSITE_URL} to answer questions.
        If you don't know the answer, say you don't know but offer to help find something else.
        Be professional, technical, and helpful.
        IMPORTANT: Always respond in the same language the user is using. 
        Detect the language from the user's input message. 
        If the user's input language is unclear, use the browser's preferred language: ${browserLang}.
        Translate your technical knowledge accurately into the detected language.
        
        CRITICAL: Before giving any advice or product recommendations, you MUST first ask 3 relevant questions to gather more details about the user's specific situation or project. 
        Ask these questions ONE BY ONE. Ask one question, wait for the user's response, then ask the next one. 
        Only after the user has answered all 3 questions should you provide your advice or recommendations.
        
        STYLE & FORMATTING:
        1. Be extremely concise. Use short sentences and avoid long paragraphs.
        2. Use blank lines (double newlines) between all distinct sections (intro, questions, advice, product lists).
        3. Use bullet points for product features or lists to make them scannable.
        4. Keep your introduction to a single, brief sentence.
        5. When providing product recommendations, ALWAYS include the full, visible URL link to the relevant products on HeatShieldings.com (e.g., https://heatshieldings.com/product-name) so the user can see the exact link they are clicking.
        6. Make your questions specific and targeted to the user's project.
        7. If the user asks to speak to a human or contact support, provide the email address info@heatshieldings.com and mention that a reply will be sent within 24 hours on business days.`;

  try {
    let response: GenerateContentResponse | null = null;
    
    try {
      // First attempt: Gemini 3 Flash
      console.log("Attempting Gemini request (gemini-3-flash-preview)...");
      const chatPromise = ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: [...contents, { role: 'user', parts: [{ text: message }] }],
        config: {
          systemInstruction,
          tools: [{ googleSearch: {} }]
        },
      });

      const timeoutPromise = new Promise<null>((_, reject) => 
        setTimeout(() => reject(new Error("Chat response timeout (Primary)")), 20000)
      );

      response = await Promise.race([chatPromise, timeoutPromise]) as GenerateContentResponse | null;
      console.log("Gemini request successful");
    } catch (initialError: any) {
      console.warn("Primary Gemini request failed or timed out:", initialError);
      
      // Secondary attempt: Gemini 3.1 Pro
      console.log("Retrying with gemini-3.1-pro-preview...");
      try {
        const secondaryPromise = ai.models.generateContent({
          model: "gemini-3.1-pro-preview",
          contents: [...contents, { role: 'user', parts: [{ text: message }] }],
          config: {
            systemInstruction,
            tools: [{ googleSearch: {} }]
          },
        });

        const timeoutPromise = new Promise<null>((_, reject) => 
          setTimeout(() => reject(new Error("Chat response timeout (Secondary)")), 30000)
        );

        response = await Promise.race([secondaryPromise, timeoutPromise]) as GenerateContentResponse | null;
        console.log("Gemini secondary request successful");
      } catch (secondaryError: any) {
        // Final fallback: no tools
        console.warn("Secondary failed, final try without tools...");
        const finalPromise = ai.models.generateContent({
          model: "gemini-3-flash-preview",
          contents: [...contents, { role: 'user', parts: [{ text: message }] }],
          config: {
            systemInstruction
          },
        });
        response = await finalPromise;
      }
    }

    const text = response?.text || "I'm sorry, I couldn't process that request.";
    
    // Extract sources if available
    const sources: string[] = [];
    const chunks = response?.candidates?.[0]?.groundingMetadata?.groundingChunks;
    if (chunks) {
      chunks.forEach((chunk: any) => {
        if (chunk.web?.uri) sources.push(chunk.web.uri);
      });
    }

    return {
      role: 'model',
      text,
      sources: sources.length > 0 ? Array.from(new Set(sources)) : undefined
    };
  } catch (error: any) {
    console.error("Gemini API Error:", error);
    let errorMessage = "I encountered an error while trying to reach the knowledge base. Please try again later.";
    
    const errorStr = String(error).toLowerCase();
    if (errorStr.includes('429') || errorStr.includes('quota')) {
      errorMessage = "I've hit my usage limit for today. If you've just upgraded, it may take 5-10 minutes for the changes to take effect. Please try again shortly.";
    } else if (errorStr.includes('billing') || errorStr.includes('upgrade') || errorStr.includes('403')) {
      errorMessage = "Access restricted. If you have already upgraded, please ensure your billing account is active and linked to this project in the Google Cloud Console. This can sometimes take a few minutes to propagate.";
    } else if (errorStr.includes('safety') || errorStr.includes('finish_reason_safety')) {
      errorMessage = "I'm sorry, I cannot provide a response to that specific query due to safety guidelines. Please try asking in a different way.";
    } else if (errorStr.includes('timeout')) {
      errorMessage = "The request timed out. The website might be slow or the connection was interrupted. Please try again.";
    }
    
    return {
      role: 'model',
      text: errorMessage
    };
  }
}
