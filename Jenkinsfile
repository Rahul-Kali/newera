pipeline {
    agent any

    environment {
        DOCKER_REGISTRY = "default"
        IMAGE_TAG = "${env.BUILD_NUMBER}"
        KUBE_NAMESPACE = "default"
    }

    stages {

        stage('Checkout') {
            steps {
                checkout scm
            }
        }

        stage('Install & Test - Services') {
            steps {
                script {
                    def services = ['user-service', 'product-service', 'order-service', 'auth-service', 'inventory-service', 'payment-service', 'notification-service']
                    services.each { svc ->
                        dir("services/${svc}") {
                            sh 'npm install'
                            sh 'npm test'
                        }
                    }
                }
            }
        }

        stage('Build Docker Images') {
            steps {
                script {
                    def services = ['user-service', 'product-service', 'order-service', 'auth-service', 'inventory-service', 'payment-service', 'notification-service']
                    services.each { svc ->
                        sh """
                          docker build -t ${DOCKER_REGISTRY}/${svc}:${IMAGE_TAG} ./services/${svc}
                          docker tag ${DOCKER_REGISTRY}/${svc}:${IMAGE_TAG} ${DOCKER_REGISTRY}/${svc}:latest
                        """
                    }
                    sh """
                      docker build -t ${DOCKER_REGISTRY}/api-gateway:${IMAGE_TAG} ./api-gateway
                      docker tag ${DOCKER_REGISTRY}/api-gateway:${IMAGE_TAG} ${DOCKER_REGISTRY}/api-gateway:latest
                    """
                }
            }
        }

        stage('Load Images into Minikube') {
            steps {
                script {
                    def images = ['user-service', 'product-service', 'order-service', 'auth-service', 'inventory-service', 'payment-service', 'notification-service', 'api-gateway']
                    images.each { img ->
                        sh "minikube image load ${DOCKER_REGISTRY}/${img}:latest"
                    }
                }
            }
        }

        stage('Deploy to Kubernetes (Minikube)') {
            steps {
                sh """
                  kubectl apply -f k8s/databases/databases.yaml
                  kubectl apply -f k8s/user-service/deployment.yaml
                  kubectl apply -f k8s/product-service/deployment.yaml
                  kubectl apply -f k8s/order-service/deployment.yaml
                  kubectl apply -f k8s/auth-service/deployment.yaml
                  kubectl apply -f k8s/inventory-service/deployment.yaml
                  kubectl apply -f k8s/payment-service/deployment.yaml
                  kubectl apply -f k8s/notification-service/deployment.yaml
                  kubectl apply -f k8s/api-gateway/deployment.yaml
                  kubectl apply -f k8s/monitoring/prometheus.yaml
                  kubectl apply -f k8s/monitoring/alertmanager.yaml
                  kubectl apply -f k8s/monitoring/grafana.yaml
                """
                script {
                    def deployments = ['user-service', 'product-service', 'order-service', 'auth-service', 'inventory-service', 'payment-service', 'notification-service', 'api-gateway']
                    deployments.each { d ->
                        sh "kubectl -n ${KUBE_NAMESPACE} rollout restart deployment/${d}"
                    }
                }
            }
        }

        stage('Verify Rollout') {
            steps {
                script {
                    def deployments = ['user-service', 'product-service', 'order-service', 'auth-service', 'inventory-service', 'payment-service', 'notification-service', 'api-gateway']
                    deployments.each { d ->
                        sh "kubectl -n ${KUBE_NAMESPACE} rollout status deployment/${d}"
                    }
                }
            }
        }
    }

    post {
        success { echo 'NEWERA pipeline completed successfully.' }
        failure { echo 'NEWERA pipeline failed. Check logs above.' }
    }
}
