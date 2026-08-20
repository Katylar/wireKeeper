# /backend/Dockerfile
FROM python:3.11-slim

WORKDIR /app

# Copy your requirements file first to leverage Docker cache
COPY requirements.txt .

# Install dependencies
RUN pip install --no-cache-dir -r requirements.txt

# Copy the rest of your backend code
COPY . .

# Run the app
CMD ["python", "main.py"]