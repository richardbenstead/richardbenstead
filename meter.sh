#!/bin/bash

# Function to map a position (1-10) to a specific color code
get_color() {
    local value=$1
    case $value in
        1) echo "82"  ;; # Bright green
        2) echo "118" ;; # Light green
        3) echo "154" ;; # Yellow-green
        4) echo "190" ;; # Light yellow-green
        5) echo "226" ;; # Yellow
        6) echo "220" ;; # Dark yellow
        7) echo "214" ;; # Orange
        8) echo "208" ;; # Dark orange
        9) echo "202" ;; # Light red
        10) echo "196" ;; # Bright red
    esac
}

# Characters for the meter
FILLED_BLOCK="▣"    # Block with outline for filled portion
EMPTY_BLOCK="▢"     # Block outline for empty portion

# Calculate value based on input arguments
if [ $# -eq 2 ] && [[ $1 =~ ^[0-9]*\.?[0-9]+$ ]] && [[ $2 =~ ^[0-9]*\.?[0-9]+$ ]]; then
    # Two numbers provided - calculate ratio
    value=$(awk "BEGIN {print ($1/$2) * 10}")
elif [ $# -eq 1 ] && [[ $1 =~ ^[0-9]*\.?[0-9]+$ ]]; then
    # One number provided - use directly
    value=$1
else
    echo "Usage: $0 <value> [max_value]"
    echo "Examples:"
    echo "  $0 7.5       # Direct value between 0-10"
    echo "  $0 75 100    # Ratio calculation (75/100 * 10)"
    exit 1
fi

# Ensure value is between 0 and 10
value=$(awk "BEGIN {print ($value < 0 ? 0 : ($value > 10 ? 10 : $value))}")

# Build the meter
meter=""
for i in {1..10}; do
    color=$(get_color $i)
    # Compare with floating point
    if (( $(echo "$i <= $value" | bc -l) )); then
        # Filled block: Color with black outline
        meter="${meter}\033[38;5;${color}m${FILLED_BLOCK}"
    else
        # Check if this block should be partially filled (within 1 unit of value)
        if (( $(echo "$i - $value <= 1" | bc -l) )) && (( $(echo "$i > $value" | bc -l) )); then
            # Calculate partial block (▤ ▥ ▦ ▧ ▨ ▩)
            fraction=$(awk "BEGIN {print ($value - int($value))}")
            if (( $(echo "$fraction <= 0.16" | bc -l) )); then
                block="▢"  # Empty
            elif (( $(echo "$fraction <= 0.33" | bc -l) )); then
                block="▤"  # Light shade
            elif (( $(echo "$fraction <= 0.5" | bc -l) )); then
                block="▥"  # Medium light shade
            elif (( $(echo "$fraction <= 0.66" | bc -l) )); then
                block="▦"  # Medium shade
            elif (( $(echo "$fraction <= 0.83" | bc -l) )); then
                block="▧"  # Medium heavy shade
            else
                block="▨"  # Heavy shade
            fi
            meter="${meter}\033[38;5;${color}m${block}"
        else
            # Empty block: Just outline in the color that would be used if filled
            meter="${meter}\033[38;5;${color}m${EMPTY_BLOCK}"
        fi
    fi
done

# Reset color at the end
meter="${meter}\033[0m"

# Display the meter
echo -e "$meter"
