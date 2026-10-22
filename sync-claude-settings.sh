#!/bin/bash
# Copies this desktop's Claude Code setup to a dev server: rtk (which settings.json sends every command through),
# settings.json with this machine's home folder changed to the server's, CLAUDE.md, RTK.md, hooks, skills, the
# websites project's memory, and the enabled plugins, installed fresh from their marketplaces (copies would carry
# programs built for this machine's processor).
# Also, unless left out: Claude's sign-in (~/.claude/.credentials.json; --no-credentials leaves it out, then run claude
# and /login on the server) and the GitHub key (~/.ssh/id_ed25519 with GitHub's host keys as this machine knows them;
# --no-ssh-key leaves it out). The MCP servers' keys are never copied: add them there.
# Left out on purpose: the reverse-engineer-anything skill (rea).
# Run from the desktop: bash sync-claude-settings.sh user@host [--no-credentials] [--no-ssh-key], or set DEVHOST=user@host.
# Safe to run again.
set -euo pipefail
HOST=${DEVHOST:-}
CREDENTIALS=yes SSH_KEY=yes
for arg in "$@"; do
  case $arg in
    --no-credentials) CREDENTIALS=no ;;
    --no-ssh-key) SSH_KEY=no ;;
    --credentials) ;; # the old way to ask for the sign-in, now the default
    *) HOST=$arg ;;
  esac
done
[ -n "$HOST" ] || { echo "usage: sync-claude-settings.sh user@host [--no-credentials] [--no-ssh-key]  (or set DEVHOST)"; exit 1; }
RTK=$(rtk --version | awk '{print $2}')
REMOTE_HOME=$(ssh "$HOST" 'echo $HOME')

# rtk at the desktop's version, built for the server's processor.
ssh "$HOST" "set -e; arch=\$(uname -m); have=\$(~/.local/bin/rtk --version 2>/dev/null || true)
if [ \"\$have\" != 'rtk $RTK' ]; then
  rm -rf /tmp/rtk && mkdir -p /tmp/rtk ~/.local/bin
  curl -fsSL https://github.com/rtk-ai/rtk/releases/download/v$RTK/rtk-\$arch-unknown-linux-gnu.tar.gz | tar -xz -C /tmp/rtk
  install -m 755 \"\$(find /tmp/rtk -type f -name rtk | head -1)\" ~/.local/bin/rtk
fi
echo \"server: \$(~/.local/bin/rtk --version)\""

# Instructions, hooks and skills as they are; settings with this machine's home folder changed to the server's.
ssh "$HOST" 'mkdir -p ~/.claude'
rsync -a --exclude reverse-engineer-anything "$HOME/.claude/CLAUDE.md" "$HOME/.claude/RTK.md" "$HOME/.claude/hooks" "$HOME/.claude/skills" "$HOST:.claude/"
sed "s#$HOME#$REMOTE_HOME#g" "$HOME/.claude/settings.json" | ssh "$HOST" 'cat > ~/.claude/settings.json'

# The websites project's memory, filed under the project's path on the server (~/websites).
key() { echo "$1" | sed 's#[/.]#-#g'; }
ssh "$HOST" "mkdir -p ~/.claude/projects/$(key "$REMOTE_HOME/websites")/memory"
rsync -a "$HOME/.claude/projects/$(key "$HOME/projects/websites")/memory/" "$HOST:.claude/projects/$(key "$REMOTE_HOME/websites")/memory/"

# The enabled plugins, from the same marketplaces as here.
ssh "$HOST" 'export PATH=$HOME/.local/bin:$PATH
for m in anthropics/claude-plugins-official DietrichGebert/ponytail mksglu/context-mode; do claude plugin marketplace add "$m" > /dev/null 2>&1 || true; done
for p in ponytail context-mode superpowers playwright frontend-design; do claude plugin install "$p" > /dev/null 2>&1 && echo "plugin $p installed" || echo "plugin $p NOT installed"; done'
# Claude's sign-in: the same token as this machine, kept readable by its owner alone.
if [ "$CREDENTIALS" = yes ]; then
  scp -p "$HOME/.claude/.credentials.json" "$HOST:.claude/.credentials.json"
  ssh "$HOST" 'chmod 600 ~/.claude/.credentials.json'
  echo "credentials copied: claude on $HOST is signed in as on this machine"
else
  echo "not signed in: run claude and /login on $HOST, or run this again without --no-credentials"
fi
# The GitHub key, the same as this machine's (scp -p keeps it readable by its owner alone), and GitHub's host keys from
# this machine's known_hosts, added only if the server knows none, so the first git fetch there does not stop to ask.
if [ "$SSH_KEY" = yes ]; then
  ssh "$HOST" 'mkdir -p -m 700 ~/.ssh'
  scp -p "$HOME/.ssh/id_ed25519" "$HOME/.ssh/id_ed25519.pub" "$HOST:.ssh/"
  ssh-keygen -F github.com | grep -v '^#' | ssh "$HOST" 'ssh-keygen -F github.com > /dev/null 2>&1 || cat >> ~/.ssh/known_hosts'
  echo "ssh key copied: git on $HOST reaches GitHub as this machine does"
fi
echo "synced to $HOST. MCP server keys are not copied: add those servers there with claude mcp add."
