#!/usr/bin/env bash
set -e

DIR="$(cd "$(dirname "$0")" && pwd)"
R='\033[0;31m' G='\033[0;32m' Y='\033[1;33m' B='\033[0;34m' C='\033[0;36m' W='\033[0m'

kill_servers() {
  kill $(lsof -ti:8765) 2>/dev/null || true
  sleep 1
}

send_ws() {
  echo "$1" | node -e "
    const { WebSocket } = require('ws');
    const ws = new WebSocket('ws://localhost:8765');
    ws.on('open', () => { ws.send(process.argv[1]); setTimeout(process.exit, 500); });
    ws.on('error', () => { process.exit(1); });
  " "$1" 2>/dev/null
}

# ─── MAIN MENU ───
while true; do
  clear 2>/dev/null || true
  echo -e "${R}"
  echo "╔══════════════════════════════════════════════╗"
  echo "║     🏏  Cricket Stream Controller           ║"
  echo "╚══════════════════════════════════════════════╝"
  echo -e "${W}"

  # Check if server is running
  if lsof -ti:8765 &>/dev/null; then
    echo -e "  ${G}●${W} Server: ${G}Running${W} on ws://localhost:8765"
  else
    echo -e "  ${R}○${W} Server: ${R}Stopped${W}"
  fi

  # Check poller
  if pgrep -f "live-score-poller" &>/dev/null; then
    echo -e "  ${G}●${W} Score poller: ${G}Active${W}"
  else
    echo -e "  ${R}○${W} Score poller: ${R}Off${W}"
  fi

  echo ""
  echo -e "  ${Y}[1]${W} 🚀  Start Stream — chat + live score"
  echo -e "  ${Y}[2]${W} 📊  Start Live Score Poller"
  echo -e "  ${Y}[3]${W} 🔗  Change Match URL"
  echo -e "  ${Y}[4]${W} 💬  Pop a Chat Message"
  echo -e "  ${Y}[5]${W} 🧹  Clear Chat"
  echo -e "  ${Y}[6]${W} 📋  View Status Logs"
  echo -e "  ${Y}[7]${W} ⏹️   Stop All Servers"
  echo -e "  ${Y}[0]${W} ❌  Exit"
  echo ""
  read -r -p "  ➜ " choice </dev/tty

  case "$choice" in
    1)
      echo ""
      echo -e "${C}── Starting Stream ──${W}"
      read -r -p "  YouTube Video ID [5ChdXWQakpA]: " vid
      vid="${vid:-5ChdXWQakpA}"
      read -r -p "  Score URL(s) (comma-separated, or leave blank): " url

      kill_servers

      # Write video ID to .env
      if [[ "$OSTYPE" == "darwin"* ]]; then
        sed -i '' "s/VIDEO_ID=.*/VIDEO_ID=$vid/" "$DIR/.env"
      else
        sed -i "s/VIDEO_ID=.*/VIDEO_ID=$vid/" "$DIR/.env"
      fi

      # Start YouTube chat server
      echo -e "${B}  🚀 Starting YouTube chat server...${W}"
      nohup node "$DIR/yt-chat-server.js" > "$DIR/server.log" 2>&1 &
      sleep 2

      # Start poller if URL given
      if [ -n "$url" ]; then
        echo -e "${B}  📊 Starting live score poller...${W}"
        if [[ "$url" == *","* ]]; then
          SCORE_URLS="$url" nohup node "$DIR/live-score-poller.js" > "$DIR/poller.log" 2>&1 &
        else
          SCORE_URL="$url" nohup node "$DIR/live-score-poller.js" > "$DIR/poller.log" 2>&1 &
        fi
        sleep 1
        echo -e "${G}  ✅ Score polling from:${W} ${C}$url${W}"
      fi

      echo -e "${G}  ✅ Stream started!${W}"
      echo -e "  ${Y}  OBS → Browser Source → file://${DIR}/chat-overlay.html${W}"
      echo -e "  ${Y}  Server log: tail -f $DIR/server.log${W}"
      read -r -p "  Press Enter to continue..." dummy
      ;;

    2)
      echo ""
      read -r -p "  Score URL(s) (comma-separated): " url
      if [ -z "$url" ]; then
        echo -e "${R}  ⛔ URL required${W}"
        sleep 2
        continue
      fi
      kill $(lsof -ti:8765) 2>/dev/null || true
      sleep 1
      if [[ "$url" == *","* ]]; then
        SCORE_URLS="$url" nohup node "$DIR/live-score-poller.js" > "$DIR/poller.log" 2>&1 &
      else
        SCORE_URL="$url" nohup node "$DIR/live-score-poller.js" > "$DIR/poller.log" 2>&1 &
      fi
      echo -e "${G}  ✅ Poller started for:${W} ${C}$url${W}"
      read -r -p "  Press Enter to continue..." dummy
      ;;

    3)
      echo ""
      read -r -p "  New Score URL(s) (comma-separated): " url
      if [ -z "$url" ]; then
        echo -e "${R}  ⛔ URL required${W}"
        sleep 2
        continue
      fi
      # Kill existing poller
      pkill -f "live-score-poller" 2>/dev/null || true
      sleep 1
      # If server is running, start poller with new URL
      if lsof -ti:8765 &>/dev/null; then
        if [[ "$url" == *","* ]]; then
          SCORE_URLS="$url" nohup node "$DIR/live-score-poller.js" > "$DIR/poller.log" 2>&1 &
        else
          SCORE_URL="$url" nohup node "$DIR/live-score-poller.js" > "$DIR/poller.log" 2>&1 &
        fi
        echo -e "${G}  ✅ Poller updated!${W}"
      else
        echo -e "${R}  ⛔ Server not running. Start stream first.${W}"
      fi
      read -r -p "  Press Enter to continue..." dummy
      ;;

    4)
      echo ""
      echo -e "${C}── Pop Chat Message ──${W}"
      read -r -p "  Name [Fan]: " name; name="${name:-Fan}"
      echo -e "  Type: ${Y}[1]${W} Chat  ${Y}[2]${W} Super Chat  ${Y}[3]${W} Member  ${Y}[4]${W} Mod  ${Y}[5]${W} Announce"
      read -r -p "  ➜ " t
      case "$t" in
        2) type="superchat"; read -r -p "  Amount \$: " amt ;;
        3) type="membership" ;;
        4) type="moderator" ;;
        5) type="announcement" ;;
        *) type="chat" ;;
      esac
      read -r -p "  Message: " msg
      [ -z "$msg" ] && echo -e "${R}  ⛔ Message required${W}" && sleep 2 && continue
      payload="{\"type\":\"youtube-chat\",\"name\":\"$name\",\"text\":\"$msg\",\"msgType\":\"$type\""
      [ -n "$amt" ] && payload+=",\"amount\":\"$amt\""
      payload+="}"
      send_ws "$payload" && echo -e "${G}  ✅ ${name}: ${msg}${W}" || echo -e "${R}  ⛔ Server not running${W}"
      read -r -p "  Press Enter to continue..." dummy
      ;;

    5)
      send_ws '{"type":"hide-comment","_clear":true}' 2>/dev/null
      echo -e "${G}  ✅ Chat cleared${W}"
      sleep 1
      ;;

    6)
      echo ""
      echo -e "${C}── Server Log ──${W}"
      [ -f "$DIR/server.log" ] && tail -5 "$DIR/server.log" || echo "  N/A"
      echo ""
      echo -e "${C}── Poller Log ──${W}"
      [ -f "$DIR/poller.log" ] && tail -5 "$DIR/poller.log" || echo "  N/A"
      echo ""
      read -r -p "  Press Enter to continue..." dummy
      ;;

    7)
      kill_servers
      pkill -f "live-score-poller" 2>/dev/null || true
      echo -e "${R}  ⏹️  All servers stopped${W}"
      sleep 2
      ;;

    0)
      echo -e "${Y}  👋 Goodbye!${W}"
      exit 0
      ;;

    *)
      echo -e "${R}  ❌ Invalid option${W}"
      sleep 1
      ;;
  esac
done
