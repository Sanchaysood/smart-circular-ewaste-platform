import os, joblib, pandas as pd, numpy as np
from sklearn.preprocessing import OneHotEncoder
from sklearn.compose import ColumnTransformer
from sklearn.pipeline import Pipeline
from xgboost import XGBRegressor
from sklearn.ensemble import RandomForestClassifier

DATA = os.path.join("..","data","raw","listings.csv")
MODELS = os.path.join("..","backend","models")
os.makedirs(MODELS, exist_ok=True)

df = pd.read_csv(DATA)
df = df.dropna(subset=["category","brand","age_months","original_price","listed_price"]).copy()
df["age_years"] = df["age_months"]/12.0
df["issue_score"] = df["defect_count"] + df["screen_issues"] + df["body_issues"]
df["has_accessories"] = (df["accessories"].fillna("")!="").astype(int)

y_price = df["listed_price"].values
base = df["category"].map({"mobile":48,"laptop":72,"tablet":60,"tv":84}).fillna(60).values
y_rul = np.clip(base - df["age_months"].values, 0, None)
y_dec = ((df["battery_health"].fillna(60) > 70) & (df["issue_score"]<=1)).astype(int).values

num = ["age_months","age_years","original_price","battery_health","storage_gb","ram_gb","issue_score","has_accessories"]
cat = ["category","brand","model","city"]
X = df[cat+num]

pre = ColumnTransformer([("cat", OneHotEncoder(handle_unknown="ignore"), cat), ("num","passthrough",num)])

price_model = Pipeline([("pre",pre), ("xgb",XGBRegressor(n_estimators=200, max_depth=6, subsample=0.9, colsample_bytree=0.9, random_state=42))])
rul_model   = Pipeline([("pre",pre), ("xgb",XGBRegressor(n_estimators=200, max_depth=6, subsample=0.9, colsample_bytree=0.9, random_state=42))])
dec_model   = Pipeline([("pre",pre), ("rf",RandomForestClassifier(n_estimators=300, random_state=42))])

price_model.fit(X, y_price); joblib.dump(price_model, os.path.join(MODELS,"price_model.pkl"))
rul_model.fit(X, y_rul);     joblib.dump(rul_model,   os.path.join(MODELS,"rul_model.pkl"))
dec_model.fit(X, y_dec);     joblib.dump(dec_model,   os.path.join(MODELS,"decision_model.pkl"))
print("saved models in", MODELS)
