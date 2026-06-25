import numpy as np

class SignLanguagePredictor:
    def __init__(self):
        # Aquí se cargaría el modelo LSTM o instanciarías la interfaz para Gemma
        # self.model = load_model('path/to/lstm.h5')
        self.sequence = []
        self.sequence_length = 30 # Depende de cómo entrenaste tu LSTM (ej: 30 frames)
        self.threshold = 0.8
        
        # Mapeo de predicciones (ejemplo)
        self.actions = ['Hola', 'Gracias', 'Por favor', 'Adios']
        
    def extract_keypoints(self, landmarks_dict):
        """
        Normaliza y aplana el diccionario de landmarks recibido de MediaPipe (Frontend)
        en un solo array de NumPy de forma (num_features, )
        """
        pose = np.array([[res['x'], res['y'], res['z']] for res in landmarks_dict['pose']]).flatten() if landmarks_dict.get('pose') else np.zeros(33*3)
        lh = np.array([[res['x'], res['y'], res['z']] for res in landmarks_dict['leftHand']]).flatten() if landmarks_dict.get('leftHand') else np.zeros(21*3)
        rh = np.array([[res['x'], res['y'], res['z']] for res in landmarks_dict['rightHand']]).flatten() if landmarks_dict.get('rightHand') else np.zeros(21*3)
        
        return np.concatenate([pose, lh, rh])

    def process_frame(self, landmarks_dict):
        """
        Recibe un frame, extrae puntos, los agrega a la secuencia y, si la secuencia
        está completa, realiza la inferencia.
        """
        if not landmarks_dict:
            return None
            
        keypoints = self.extract_keypoints(landmarks_dict)
        self.sequence.append(keypoints)
        
        # se mantienen solo los últimos 'sequence_length' frames
        self.sequence = self.sequence[-self.sequence_length:]
        
        if len(self.sequence) == self.sequence_length:
            # Aquí ocurre la inferencia real
            # input_data = np.expand_dims(self.sequence, axis=0)
            # res = self.model.predict(input_data)[0]
            
            # Mock Result para desarrollo:
            # Selecciona aleatoriamente una acción para simular la traducción
            import random
            mock_res = random.choice(self.actions)
            
            # Limpiar la secuencia después de predecir para evitar traducciones repetidas
            # (O implementar lógica de umbral de confianza y debounce temporal)
            self.sequence = []
            return f"Seña detectada: {mock_res}"
            
        return None
