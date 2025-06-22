#!/bin/bash

# Save this as ~/.tmux/scripts/status-meter.sh
get_color() {
    local value=$1
    case $value in
        1) echo "colour82"  ;; # Bright green
        2) echo "colour118" ;; # Light green
        3) echo "colour154" ;; # Yellow-green
        4) echo "colour190" ;; # Light yellow-green
        5) echo "colour226" ;; # Yellow
        6) echo "colour220" ;; # Dark yellow
        7) echo "colour214" ;; # Orange
        8) echo "colour208" ;; # Dark orange
        9) echo "colour202" ;; # Light red
        10) echo "colour196" ;; # Bright red
    esac
}

FILLED_BLOCK="▣"
EMPTY_BLOCK="▢"

# Take a value between 0-1 as input
value=$1
# Convert to scale of 10
value=$(echo "$value * 10" | bc -l)
# Ensure value is between 0 and 10
value=$(echo "if($value<0) 0 else if($value>10) 10 else $value" | bc -l)

# Build the meter with tmux color syntax
meter=""
for i in {1..10}; do
    color=$(get_color $i)
    if (( $(echo "$i <= $value" | bc -l) )); then
        meter="${meter}#[fg=${color}]${FILLED_BLOCK}"
    else
        meter="${meter}#[fg=${color}]${EMPTY_BLOCK}"
    fi
done

echo "$meter#[default]"
