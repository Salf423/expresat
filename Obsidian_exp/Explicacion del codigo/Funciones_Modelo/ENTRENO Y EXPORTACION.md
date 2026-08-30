## Key Concepts

- **GRU**: A variant of recurrent neural networks that is parameter-efficient compared to LSTM (Long Short-Term Memory).
- **Quantization**: Process of reducing model weight precision from float32 to int8, decreasing model size and improving inference latency.
- **ONNX**: Open Neural Network Exchange, a format that enables interoperability between different machine learning frameworks.

## Code Structure

The code is organized into several sections including:

1. **Imports**: Loading required libraries.
2. **Constant Definitions**: Model architecture parameters and synthetic data configurations.
3. **GRU Model**: Implementation of the neural network.
4. **Synthetic Dataset**: Data generation for training.
5. **Training**: Function to train the model.
6. **Quantization**: Application of dynamic quantization.
7. **ONNX Export**: Functions to export the model to ONNX format.
8. **Latency Benchmark**: Measuring model performance.
9. **Main Function**: Workflow orchestration.

## Code Examples

Below are code snippets illustrating the key parts of the script.

### GRU Model Definition

```python
class SignLanguageGRU(nn.Module):
    def __init__(self, input_size: int = NUM_FEATURES,
                 hidden_size: int = 64,
                 num_layers: int = 1,
                 num_classes: int = len(DEFAULT_LABELS),
                 dropout: float = 0.3):
        super().__init__()
        self.gru = nn.GRU(input_size=input_size, hidden_size=hidden_size, num_layers=num_layers, batch_first=True)
        self.classifier = nn.Sequential(
            nn.Linear(hidden_size, 32),
            nn.ReLU(),
            nn.Dropout(dropout),
            nn.Linear(32, num_classes)
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        output, h_n = self.gru(x)
        last_hidden = h_n[-1]
        logits = self.classifier(last_hidden)
        return logits
```

This snippet defines the GRU model architecture, which includes a GRU layer and a classification head.

### Model Training

```python
def train_model(model: nn.Module, epochs: int = 50, lr: float = 1e-3,
                batch_size: int = 64, device: str = "cpu") -> nn.Module:
    model = model.to(device)
    model.train()
    dataset = SyntheticSignDataset()
    dataloader = DataLoader(dataset, batch_size=batch_size, shuffle=True)
    criterion = nn.CrossEntropyLoss()
    optimizer = optim.AdamW(model.parameters(), lr=lr)

    for epoch in range(epochs):
        for batch_x, batch_y in dataloader:
            batch_x = batch_x.to(device)
            batch_y = batch_y.to(device)
            optimizer.zero_grad()
            logits = model(batch_x)
            loss = criterion(logits, batch_y)
            loss.backward()
            optimizer.step()
```

This snippet demonstrates how the model is trained using a synthetic dataset.

### ONNX Export

```python
def export_to_onnx(model: nn.Module, output_path: str):
    model.eval()
    dummy_input = torch.randn(1, SEQUENCE_LENGTH, NUM_FEATURES)
    torch.onnx.export(model, dummy_input, output_path, export_params=True, opset_version=17)
```

Here it illustrates how the trained model is exported to ONNX format, enabling its use across different platforms.
