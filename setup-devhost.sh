#!/bin/bash
# Sets up tmux, Neovim, zsh and Claude Code on a fresh Ubuntu machine the way they are on the desktop, from this repo
# (github.com/richardbenstead/richardbenstead). Run it on the machine itself: bash setup-devhost.sh
# Safe to run again: it brings the repo up to date and skips what is already there.
# The desktop's ~/.zshrc is not in this repo; copy it across first (scp ~/.zshrc host:) and it is kept.
# The gpt script is left out on purpose: it holds an API key.
set -u
REPO=https://github.com/richardbenstead/richardbenstead.git
DOT=$HOME/projects/richardbenstead

# tmux, Neovim, zsh, htop (tmux's ~ key), and what YouCompleteMe's build and Neovim's Python support need.
sudo apt-get update -qq
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq tmux neovim zsh htop git curl build-essential cmake \
  python3-dev python3-pynvim black > /dev/null || echo "setup-devhost: some packages failed"

# This repo: cloned once, brought up to date after.
if [ -d "$DOT/.git" ]; then git -C "$DOT" pull -q --ff-only; else mkdir -p "$(dirname "$DOT")" && git clone -q "$REPO" "$DOT"; fi

# The same links as on the desktop.
ln -sfn "$DOT/tmux.conf" "$HOME/.tmux.conf"
mkdir -p "$HOME/.config/nvim" && ln -sfn "$DOT/init.vim" "$HOME/.config/nvim/init.vim"
ln -sfn "$DOT/tmux_mem.sh" "$HOME/tmux_mem.sh"
ln -sfn "$DOT/tmux_meter.sh" "$HOME/tmux_meter.sh"

# zsh with oh-my-zsh: tmux.conf opens every window in zsh. An existing ~/.zshrc is kept.
if [ ! -d "$HOME/.oh-my-zsh" ]; then
  RUNZSH=no CHSH=no KEEP_ZSHRC=yes sh -c "$(curl -fsSL https://raw.githubusercontent.com/ohmyzsh/ohmyzsh/master/tools/install.sh)" "" --unattended > /dev/null
fi
[ "$(getent passwd "$USER" | cut -d: -f7)" = /usr/bin/zsh ] || sudo chsh -s /usr/bin/zsh "$USER"

# vim-plug, then every plugin init.vim names.
curl -fsSLo "$HOME/.local/share/nvim/site/autoload/plug.vim" --create-dirs https://raw.githubusercontent.com/junegunn/vim-plug/master/plug.vim
nvim --headless +PlugInstall +qall > /dev/null 2>&1

# YouCompleteMe's compiled part, once, with JavaScript completion (tsserver, which needs Node on the path).
YCM=$HOME/.local/share/nvim/plugged/YouCompleteMe
if [ -d "$YCM" ] && ! compgen -G "$YCM/third_party/ycmd/ycm_core*.so" > /dev/null; then
  (cd "$YCM" && python3 install.py --ts-completer > /tmp/ycm-build.log 2>&1) || echo "setup-devhost: YouCompleteMe build failed, see /tmp/ycm-build.log"
fi

# Claude Code, with its own installer (into ~/.local/bin), on zsh's path, and brought up to date every day by cron.
# Its sign-in comes from sync-claude-settings.sh, run from the desktop (or run claude and type /login).
[ -x "$HOME/.local/bin/claude" ] || curl -fsSL https://claude.ai/install.sh | bash > /dev/null
grep -qs 'HOME/.local/bin' "$HOME/.zshrc" || echo 'export PATH="$HOME/.local/bin:$PATH"' >> "$HOME/.zshrc"
mkdir -p "$HOME/.cache"
# Daily at 04:17 machine time, logged to ~/.cache/claude-update.log; any earlier line for it is replaced, not doubled.
( crontab -l 2>/dev/null | grep -v 'claude update'; echo '17 4 * * * $HOME/.local/bin/claude update >> $HOME/.cache/claude-update.log 2>&1' ) | crontab -

echo "setup-devhost: tmux $(tmux -V | cut -d' ' -f2), $(nvim --version | head -1), plugins: $(ls "$HOME/.local/share/nvim/plugged" 2>/dev/null | wc -l), $("$HOME/.local/bin/claude" --version 2>/dev/null | head -1)"
