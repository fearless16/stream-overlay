@echo off
echo Starting Qwen 0.6B LLM Server...
"C:\Users\user\llama-bin\llama-server.exe" -m "C:\Users\user\models\Qwen3-0.6B-Q8_0.gguf" -c 2048 --port 8080 --host 127.0.0.1
pause
