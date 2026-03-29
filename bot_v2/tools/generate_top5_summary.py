import os
import csv
import json
import sys


def main():
    base = os.path.join("bot_v2", "tools", "reports")
    grid_dir = os.path.join(base, "grid_search")

    ranked_csv = os.path.join(grid_dir, "grid_summary_ranked.csv")
    top5_json = os.path.join(grid_dir, "grid_top5.json")

    out_csv = os.path.join(base, "grid_top5_summary.csv")
    out_json = os.path.join(base, "grid_top5_detailed.json")

    if not os.path.isdir(base):
        print("Reports directory not found:", base)
        sys.exit(1)

    # Prefer ranked CSV if present
    rows = []
    if os.path.isfile(ranked_csv):
        with open(ranked_csv, newline='', encoding='utf-8') as fh:
            reader = csv.DictReader(fh)
            for r in reader:
                rows.append(r)

    if not rows and os.path.isfile(top5_json):
        # fallback: load grid_top5.json and serialize simple records
        with open(top5_json, 'r', encoding='utf-8') as fh:
            top5 = json.load(fh)
        out = []
        for item in top5:
            if isinstance(item, dict):
                out.append(item)
            else:
                out.append({"combo": str(item)})
        with open(out_json, 'w', encoding='utf-8') as fh:
            json.dump(out, fh, indent=2, ensure_ascii=False)
        print("Wrote", out_json)
        print("No ranked CSV found. Generated basic JSON from grid_top5.json.")
        sys.exit(0)

    if not rows:
        print("No grid summary data found (no ranked CSV or top5 JSON).")
        sys.exit(1)

    # Take top 5 rows
    top_rows = rows[:5]

    # Write CSV
    with open(out_csv, 'w', newline='', encoding='utf-8') as fh:
        writer = csv.DictWriter(fh, fieldnames=top_rows[0].keys())
        writer.writeheader()
        writer.writerows(top_rows)

    # Write JSON
    with open(out_json, 'w', encoding='utf-8') as fh:
        json.dump(top_rows, fh, indent=2, ensure_ascii=False)

    print("Wrote:", out_csv)
    print("Wrote:", out_json)


if __name__ == '__main__':
    main()
