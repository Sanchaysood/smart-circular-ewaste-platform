import os, torch
from torch import nn, optim
from torchvision import datasets, transforms, models
from torch.utils.data import DataLoader
from sklearn.model_selection import train_test_split
from pathlib import Path

IMG_DIR = Path("../data/raw/images")
OUT = Path("../backend/models"); OUT.mkdir(parents=True, exist_ok=True)

tfm_train = transforms.Compose([transforms.Resize((256,256)), transforms.RandomResizedCrop(224), transforms.RandomHorizontalFlip(),
                                transforms.ToTensor(), transforms.Normalize([0.485,0.456,0.406],[0.229,0.224,0.225])])
tfm_val = transforms.Compose([transforms.Resize((224,224)), transforms.ToTensor(),
                              transforms.Normalize([0.485,0.456,0.406],[0.229,0.224,0.225])])

full = datasets.ImageFolder(IMG_DIR, transform=tfm_train)
y = [full.samples[i][1] for i in range(len(full))]
train_idx, val_idx = train_test_split(range(len(full)), test_size=0.2, random_state=42, stratify=y)

from torch.utils.data import Subset
train_loader = DataLoader(Subset(full, train_idx), batch_size=32, shuffle=True)
val_loader = DataLoader(Subset(datasets.ImageFolder(IMG_DIR, transform=tfm_val), val_idx), batch_size=32)

device = "cuda" if torch.cuda.is_available() else "cpu"
model = models.resnet18(weights=models.ResNet18_Weights.IMAGENET1K_V1)
model.fc = nn.Linear(model.fc.in_features, 3)
model.to(device)

crit = nn.CrossEntropyLoss(); opt = optim.Adam(model.parameters(), lr=1e-4)
best = 0.0
for e in range(8):
    model.train()
    for x,y in train_loader:
        x,y = x.to(device), y.to(device)
        opt.zero_grad(); out = model(x); loss = crit(out,y); loss.backward(); opt.step()
    model.eval(); correct=total=0
    with torch.no_grad():
        for x,y in val_loader:
            x,y = x.to(device), y.to(device)
            pred = model(x).argmax(1)
            correct += (pred==y).sum().item(); total += y.size(0)
    acc = correct/total if total else 0
    print(f"epoch {e+1} val_acc={acc:.3f}")
    if acc>best:
        best=acc; torch.save(model.state_dict(), OUT/"condition_cnn.pt"); print("saved condition_cnn.pt")
import os, torch
from torch import nn, optim
from torchvision import datasets, transforms, models
from torch.utils.data import DataLoader
from sklearn.model_selection import train_test_split
from pathlib import Path

IMG_DIR = Path("../data/raw/images")
OUT = Path("../backend/models"); OUT.mkdir(parents=True, exist_ok=True)

tfm_train = transforms.Compose([transforms.Resize((256,256)), transforms.RandomResizedCrop(224), transforms.RandomHorizontalFlip(),
                                transforms.ToTensor(), transforms.Normalize([0.485,0.456,0.406],[0.229,0.224,0.225])])
tfm_val = transforms.Compose([transforms.Resize((224,224)), transforms.ToTensor(),
                              transforms.Normalize([0.485,0.456,0.406],[0.229,0.224,0.225])])

full = datasets.ImageFolder(IMG_DIR, transform=tfm_train)
y = [full.samples[i][1] for i in range(len(full))]
train_idx, val_idx = train_test_split(range(len(full)), test_size=0.2, random_state=42, stratify=y)

from torch.utils.data import Subset
train_loader = DataLoader(Subset(full, train_idx), batch_size=32, shuffle=True)
val_loader = DataLoader(Subset(datasets.ImageFolder(IMG_DIR, transform=tfm_val), val_idx), batch_size=32)

device = "cuda" if torch.cuda.is_available() else "cpu"
model = models.resnet18(weights=models.ResNet18_Weights.IMAGENET1K_V1)
model.fc = nn.Linear(model.fc.in_features, 3)
model.to(device)

crit = nn.CrossEntropyLoss(); opt = optim.Adam(model.parameters(), lr=1e-4)
best = 0.0
for e in range(8):
    model.train()
    for x,y in train_loader:
        x,y = x.to(device), y.to(device)
        opt.zero_grad(); out = model(x); loss = crit(out,y); loss.backward(); opt.step()
    model.eval(); correct=total=0
    with torch.no_grad():
        for x,y in val_loader:
            x,y = x.to(device), y.to(device)
            pred = model(x).argmax(1)
            correct += (pred==y).sum().item(); total += y.size(0)
    acc = correct/total if total else 0
    print(f"epoch {e+1} val_acc={acc:.3f}")
    if acc>best:
        best=acc; torch.save(model.state_dict(), OUT/"condition_cnn.pt"); print("saved condition_cnn.pt")
