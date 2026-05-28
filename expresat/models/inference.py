import numpy as np

class SignLanguagePredictor:
    def __init__(self):
        self.sequence = []
        self.sequence_length = 30 # Depende de cómo entrenaste tu LSTM (ej: 30 frames)
        self.threshold = 0.8
        
        # Mapeo de predicciones
        self.actions = ['Hola', 'Gracias', 'Por favor', 'Adios']
        
    def extract_keypoints(self, landmarks_dict):
        pose = np.array([[res['x'], res['y'], res['z']] for res in landmarks_dict['pose']]).flatten() if landmarks_dict.get('pose') else np.zeros(33*3)
        lh = np.array([[res['x'], res['y'], res['z']] for res in landmarks_dict['leftHand']]).flatten() if landmarks_dict.get('leftHand') else np.zeros(21*3)
        rh = np.array([[res['x'], res['y'], res['z']] for res in landmarks_dict['rightHand']]).flatten() if landmarks_dict.get('rightHand') else np.zeros(21*3)
        
        return np.concatenate([pose, lh, rh])

    def process_frame(self, landmarks_dict):
        if not landmarks_dict:
            return None
        keypoints = self.extract_keypoints(landmarks_dict)
        self.sequence.append(keypoints)
        self.sequence = self.sequence[-self.sequence_length:]
        if len(self.sequence) == self.sequence_length:
            import random
            mock_res = random.choice(self.actions)
            self.sequence = []
            return f"Seña detectada: {mock_res}"
            
        return None
