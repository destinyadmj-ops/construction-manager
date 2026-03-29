import random

class ReplayBuffer:
    def __init__(self, size=10000):
        self.buffer = []
        self.size = size
    def add(self, transition):
        self.buffer.append(transition)
        if len(self.buffer) > self.size:
            self.buffer.pop(0)
    def sample(self, batch_size=64):
        return random.sample(self.buffer, batch_size)
