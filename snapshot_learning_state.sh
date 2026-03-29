#!/bin/bash
# Snapshot learning state every 6 hours for analysis and trend tracking

SNAPSHOT_DIR="/home/linuxuser/learning_snapshots"
LEARNING_SUMMARY_URL="http://127.0.0.1:5001/learning-summary"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
SNAPSHOT_FILE="$SNAPSHOT_DIR/learning_$TIMESTAMP.json"

# Ensure directory exists
mkdir -p "$SNAPSHOT_DIR"

# Fetch learning summary and save
echo "Capturing learning snapshot at $TIMESTAMP..."
curl -s "$LEARNING_SUMMARY_URL" > "$SNAPSHOT_FILE" 2>&1

if [ $? -eq 0 ]; then
    echo "✓ Snapshot saved: $SNAPSHOT_FILE"
    
    # Extract metrics for brief report
    SUMMARY=$(jq '.summary' "$SNAPSHOT_FILE" 2>/dev/null)
    if [ -n "$SUMMARY" ]; then
        echo "=== Quick Status ===" >> "$SNAPSHOT_DIR/latest_report.txt"
        echo "Timestamp: $TIMESTAMP" >> "$SNAPSHOT_DIR/latest_report.txt"
        echo "$SUMMARY" | jq '.' >> "$SNAPSHOT_DIR/latest_report.txt"
        echo "" >> "$SNAPSHOT_DIR/latest_report.txt"
        
        # Also keep only last 30 snapshots to save space
        ls -1t "$SNAPSHOT_DIR"/learning_*.json | tail -n +31 | xargs -r rm
    fi
else
    echo "✗ Failed to fetch learning summary"
    exit 1
fi
