let audio = null;
let controlWebSocket = null;
const startStopBtn = document.getElementById("startStopBtn");
const statusText = document.getElementById("status");

let isRunning = false;
let isAISpeaking = false;
let userAudioContext = null;
let analyser = null;
let detectSpeechRunning = false;
let userIsSpeaking = false;
let silenceTimeout = null;
let userInterrupted = false;

startStopBtn.addEventListener("click", async () => {
    if (!isRunning) {
        try {
            statusText.innerText = "Connecting...";
            startStopBtn.disabled = true;

            audio = new ag2client.WebsocketAudio(socketUrl);
            await audio.start();

            controlWebSocket = new WebSocket(socketUrl);
            controlWebSocket.onopen = () => {
                console.log("Control channel connected");
            };
            controlWebSocket.onerror = (error) => {
                console.error("Control channel error:", error);
            };

            setupUserSpeechDetection();

            statusText.innerText = "Live 🎙";
            startStopBtn.innerText = "Stop Conversation";
            startStopBtn.style.backgroundColor = "#c00"; 
            isRunning = true;
        } catch (error) {
            console.error("Failed to start audio:", error);
            statusText.innerText = "Error starting audio";
        } finally {
            startStopBtn.disabled = false;
        }
    } else {
        try {
            await audio.stop();
            
            if (controlWebSocket) {
                controlWebSocket.close();
                controlWebSocket = null;
            }
            
            detectSpeechRunning = false;
            if (userAudioContext) {
                userAudioContext.close();
                userAudioContext = null;
            }
            
            statusText.innerText = "Idle";
            startStopBtn.innerText = "Start Conversation";
            startStopBtn.style.backgroundColor = "#000";
            isRunning = false;
        } catch (error) {
            console.error("Failed to stop audio:", error);
            statusText.innerText = "Error stopping audio";
        }
    }
});

function setupUserSpeechDetection() {
    navigator.mediaDevices.getUserMedia({ audio: true })
        .then(stream => {
            userAudioContext = new (window.AudioContext || window.webkitAudioContext)();
            analyser = userAudioContext.createAnalyser();
            analyser.fftSize = 2048;
            const microphone = userAudioContext.createMediaStreamSource(stream);
            microphone.connect(analyser);
            
            const dataArray = new Uint8Array(analyser.frequencyBinCount);
            detectSpeechRunning = true;
            const SPEECH_THRESHOLD = 30;
            const SILENCE_DURATION = 1500;
            
            function detectSpeech() {
                if (!detectSpeechRunning) return;
                
                analyser.getByteFrequencyData(dataArray);
                const average = dataArray.reduce((a, b) => a + b) / dataArray.length;
                
                if (average > SPEECH_THRESHOLD && !userIsSpeaking && isAISpeaking) {
                    userIsSpeaking = true;
                    userInterrupted = true;
                    console.log("User overlapping AI - STOPPING AI to listen!");
                    statusText.innerText = "🎤 You: speaking...";
                    
                    try {
                        if (controlWebSocket && controlWebSocket.readyState === WebSocket.OPEN) {
                            controlWebSocket.send(JSON.stringify({ type: "interrupt" }));
                        }
                    } catch (e) {
                        console.error("Error sending interrupt signal:", e);
                    }
                    
                    if (silenceTimeout) {
                        clearTimeout(silenceTimeout);
                        silenceTimeout = null;
                    }
                }
                else if (average > SPEECH_THRESHOLD && !userIsSpeaking && !isAISpeaking) {
                    userIsSpeaking = true;
                    userInterrupted = false;
                    console.log("User speaking detected");
                    statusText.innerText = "🎤 Listening...";
                    
                    if (silenceTimeout) {
                        clearTimeout(silenceTimeout);
                        silenceTimeout = null;
                    }
                }
                else if (average > SPEECH_THRESHOLD && userIsSpeaking) {
                    if (silenceTimeout) {
                        clearTimeout(silenceTimeout);
                        silenceTimeout = null;
                    }
                }
                else if (average <= SPEECH_THRESHOLD && userIsSpeaking) {
                    if (!silenceTimeout) {
                        silenceTimeout = setTimeout(() => {
                            userIsSpeaking = false;
                            silenceTimeout = null;
                            console.log("User finished speaking - waiting for AI response");
                            statusText.innerText = "⏳ Processing...";
                            
                            try {
                                if (controlWebSocket && controlWebSocket.readyState === WebSocket.OPEN) {
                                    controlWebSocket.send(JSON.stringify({ 
                                        type: "user_finished",
                                        interrupted: userInterrupted
                                    }));
                                }
                            } catch (e) {
                                console.error("Error sending user_finished signal:", e);
                            }
                        }, SILENCE_DURATION);
                    }
                }
                
                requestAnimationFrame(detectSpeech);
            }
            detectSpeech();
            console.log("Smart interruption mode: AI stops when you talk, listens to your full message, then responds");
        })
        .catch(error => {
            console.error("Microphone access denied:", error);
            statusText.innerText = "Microphone access required";
        });
}