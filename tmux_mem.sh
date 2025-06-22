~/tmux_meter.sh $(free --mega | grep Mem | awk '{print $3/$2}')
