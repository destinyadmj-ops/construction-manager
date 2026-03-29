import time
from pipeline.retrain import retrain
from pipeline.model_manager import update_model

def run_pipeline():
    while True:
        print("=== RETRAIN START ===")
        new_model = retrain()
        if new_model:
            update_model(new_model)
        print("=== RETRAIN DONE ===")
        # 10分ごと
        time.sleep(600)

if __name__ == "__main__":
    run_pipeline()
