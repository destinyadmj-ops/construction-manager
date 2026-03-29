import os
import shutil

MODEL_DIR = "c:/Users/desti/trading-bot/models/"
CURRENT = MODEL_DIR + "current_model.zip"

def update_model(new_model_path):
    # 最新モデルをcurrentに上書き
    shutil.copy(new_model_path + ".zip", CURRENT)
    print("Model Updated")
