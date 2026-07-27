
## Conceptos Clave

- **GRU**: Una variante de las redes neuronales recurrentes que es más eficiente en términos de parámetros en comparación con LSTM (Long Short-Term Memory).
- **Cuantización**: Proceso que reduce la precisión de los pesos del modelo de float32 a int8, lo que disminuye el tamaño del modelo y mejora la latencia en la inferencia.
- **ONNX**: Open Neural Network Exchange, un formato que permite la interoperabilidad entre diferentes frameworks de aprendizaje automático.

## Estructura del Código

El código se organiza en varias secciones que incluyen:

1. **Importaciones**: Carga de bibliotecas necesarias.
2. **Definición de constantes**: Parámetros de la arquitectura del modelo y datos sintéticos.
3. **Modelo GRU**: Implementación de la red neuronal.
4. **Dataset sintético**: Generación de datos para el entrenamiento.
5. **Entrenamiento**: Función que entrena el modelo.
6. **Cuantización**: Aplicación de la cuantización dinámica.
7. **Exportación a ONNX**: Funciones para exportar el modelo a formato ONNX.
8. **Benchmark de latencia**: Medición del rendimiento del modelo.
9. **Función principal**: Orquestación del flujo de trabajo.

## Ejemplos de Código

A continuación, se presentan fragmentos de código que ilustran las partes más importantes del script.

### Definición del Modelo GRU

language-python

`class SignLanguageGRU(nn.Module):     def __init__(self, input_size: int = NUM_FEATURES,                  hidden_size: int = 64,                  num_layers: int = 1,                  num_classes: int = len(DEFAULT_LABELS),                  dropout: float = 0.3):         super().__init__()         self.gru = nn.GRU(input_size=input_size, hidden_size=hidden_size, num_layers=num_layers, batch_first=True)         self.classifier = nn.Sequential(             nn.Linear(hidden_size, 32),             nn.ReLU(),             nn.Dropout(dropout),             nn.Linear(32, num_classes)         )      def forward(self, x: torch.Tensor) -> torch.Tensor:         output, h_n = self.gru(x)         last_hidden = h_n[-1]         logits = self.classifier(last_hidden)         return logits`

Este fragmento define la arquitectura del modelo GRU, que incluye una capa GRU y una cabeza de clasificación.

### Entrenamiento del Modelo

language-python

`def train_model(model: nn.Module, epochs: int = 50, lr: float = 1e-3,                 batch_size: int = 64, device: str = "cpu") -> nn.Module:     model = model.to(device)     model.train()     dataset = SyntheticSignDataset()     dataloader = DataLoader(dataset, batch_size=batch_size, shuffle=True)     criterion = nn.CrossEntropyLoss()     optimizer = optim.AdamW(model.parameters(), lr=lr)      for epoch in range(epochs):         for batch_x, batch_y in dataloader:             batch_x = batch_x.to(device)             batch_y = batch_y.to(device)             optimizer.zero_grad()             logits = model(batch_x)             loss = criterion(logits, batch_y)             loss.backward()             optimizer.step()`

Este fragmento muestra cómo se entrena el modelo utilizando un conjunto de datos sintético.

### Exportación a ONNX

language-python

`def export_to_onnx(model: nn.Module, output_path: str):     model.eval()     dummy_input = torch.randn(1, SEQUENCE_LENGTH, NUM_FEATURES)     torch.onnx.export(model, dummy_input, output_path, export_params=True, opset_version=17)`

Aquí se ilustra cómo se exporta el modelo entrenado a formato ONNX, lo que permite su uso en diferentes plataformas.
