const amqp = require('amqplib');
const nodemailer = require('nodemailer');
const express = require('express');
require('dotenv').config();

const app = express();
app.use(express.json());

// Configuración desde variables de entorno
const QUEUE_NAME = process.env.EMAILS_QUEUE || 'emails_queue';
const PAYMENT_QUEUE = process.env.PAYMENT_QUEUE || 'payment_events';
const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://guest:guest@127.0.0.1:5672';
const PORT = process.env.PORT || 3004;

// Configuración del transporter de Nodemailer
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASSWORD
    }
});

// Verificar configuración del email
transporter.verify(function (error, success) {
    if (error) {
        console.error('❌ Error configurando el transporter de email:', error);
    } else {
        console.log('✅ Servidor de correo listo para enviar mensajes');
    }
});

// ==================== FUNCIONES DE EMAIL ====================

async function sendPaymentConfirmationEmail(emailData) {
    console.log('✉️ DEBUG - sendPaymentConfirmationEmail INICIADO:', {
        to: emailData.to,
        subject: emailData.subject
    });

    const mailOptions = {
        from: process.env.EMAIL_FROM || 'Pagos <noreply@example.com>',
        to: emailData.to,
        subject: emailData.subject,
        html: emailData.body,
        text: emailData.body.replace(/<[^>]*>/g, '')
    };

    try {
        const info = await transporter.sendMail(mailOptions);
        console.log(`✅ Email de pago enviado a: ${emailData.to} - Message ID: ${info.messageId}`);
        return { success: true, messageId: info.messageId };
    } catch (error) {
        console.error(`❌ Error enviando email de pago a ${emailData.to}:`, error);
        return { success: false, error: error.message };
    }
}

async function sendTestEmail(emailData) {
    console.log('✉️ DEBUG - sendTestEmail INICIADO:', {
        to: emailData.to,
        subject: emailData.subject
    });

    const mailOptions = {
        from: process.env.EMAIL_FROM || 'Test <noreply@example.com>',
        to: emailData.to,
        subject: emailData.subject,
        html: emailData.body,
        text: emailData.body.replace(/<[^>]*>/g, '')
    };

    try {
        const info = await transporter.sendMail(mailOptions);
        console.log(`✅ Email de prueba enviado a: ${emailData.to}`);
        return { success: true, messageId: info.messageId };
    } catch (error) {
        console.error(`❌ Error enviando email de prueba:`, error);
        return { success: false, error: error.message };
    }
}

// ==================== PROCESAMIENTO DE EMAILS ====================

async function processEmailFromQueue(emailData) {
    console.log('📨 DEBUG - processEmailFromQueue INICIADO:', {
        to: emailData.to,
        type: emailData.type,
        subject: emailData.subject
    });

    console.log(`📧 Procesando email para: ${emailData.to}`);
    console.log(`📝 Tipo: ${emailData.type || 'General'}`);

    let result;
    
    switch (emailData.type) {
        case 'PAYMENT_CONFIRMATION':
            result = await sendPaymentConfirmationEmail(emailData);
            break;
        case 'TEST':
        default:
            result = await sendTestEmail(emailData);
            break;
    }

    return result;
}

// ==================== CONSUMERS RABBITMQ ====================

// Consumer para emails generales
async function consumeEmails() {
    let connection;
    let channel;

    try {
        console.log('🔌 Conectando a RabbitMQ para emails...');
        connection = await amqp.connect(RABBITMQ_URL);
        channel = await connection.createChannel();
        
        await channel.assertQueue(QUEUE_NAME, { durable: true });
        console.log(`✅ Cola '${QUEUE_NAME}' lista`);

        channel.prefetch(1);

        console.log(`🔄 Esperando mensajes en la cola: ${QUEUE_NAME}`);

        channel.consume(QUEUE_NAME, async (msg) => {
            console.log('📥 DEBUG - Mensaje recibido en cola emails:', msg ? '✅' : '❌ NULL');
            
            if (msg !== null) {
                try {
                    console.log('📄 DEBUG - Contenido del mensaje:', msg.content.toString());
                    const emailData = JSON.parse(msg.content.toString());
                    console.log(`📨 Email recibido: ${emailData.type || 'Sin tipo'} para ${emailData.to}`);
                    
                    const result = await processEmailFromQueue(emailData);
                    
                    if (result.success) {
                        console.log(`✅ Email procesado exitosamente: ${emailData.to}`);
                        channel.ack(msg);
                    } else {
                        console.error(`❌ Error procesando email, reintentando...: ${emailData.to}`);
                        channel.nack(msg, false, true);
                    }
                    
                } catch (error) {
                    console.error('💥 Error procesando mensaje de email:', error);
                    channel.nack(msg, false, false);
                }
            }
        }, { noAck: false });

    } catch (error) {
        console.error('💥 Error en el consumidor de emails:', error.message);
        setTimeout(consumeEmails, 5000);
    }
}

// Consumer para eventos de pago
async function consumePaymentEvents() {
  let connection;
  let channel;

  try {
    console.log('🔌 Conectando a RabbitMQ para eventos de pago...');
    connection = await amqp.connect(RABBITMQ_URL);
    channel = await connection.createChannel();
    
    await channel.assertQueue(PAYMENT_QUEUE, { durable: true });
    console.log(`✅ Cola de pagos '${PAYMENT_QUEUE}' lista`);

    channel.prefetch(1);

    console.log(`🔄 Esperando eventos de pago en: ${PAYMENT_QUEUE}`);

    channel.consume(PAYMENT_QUEUE, async (msg) => {
      console.log('📥 DEBUG - Mensaje recibido en cola pagos:', msg ? '✅' : '❌ NULL');
      
      if (msg !== null) {
        try {
          console.log('📄 DEBUG - Contenido del mensaje pago:', msg.content.toString());
          const paymentData = JSON.parse(msg.content.toString());
          console.log('💰 Evento de pago recibido:', paymentData);
          
          // Procesar el pago y enviar email
          await processPaymentEvent(paymentData);
          
          channel.ack(msg);
          
        } catch (error) {
          console.error('💥 Error procesando evento de pago:', error);
          channel.nack(msg, false, false);
        }
      }
    }, { noAck: false });

  } catch (error) {
    console.error('💥 Error en consumidor de pagos:', error);
    setTimeout(consumePaymentEvents, 5000);
  }
}

// Procesar evento de pago y enviar email
async function processPaymentEvent(paymentData) {
    console.log('🔄 Procesando evento de pago para orden:', paymentData.orderId);
    
    const emailData = {
        type: 'PAYMENT_CONFIRMATION',
        to: paymentData.userEmail,
        subject: `✅ Pago confirmado - Orden #${paymentData.orderId}`,
        body: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                <h1 style="color: #333;">¡Pago Confirmado Exitosamente!</h1>
                <p>Hola,</p>
                <p>Tu pago para la <strong>Orden #${paymentData.orderId}</strong> ha sido procesado correctamente.</p>
                
                <div style="background-color: #f5f5f5; padding: 15px; margin: 20px 0; border-radius: 5px;">
                    <h3 style="margin-top: 0; color: #2c5aa0;">Resumen de tu compra:</h3>
                    <p><strong>Número de orden:</strong> #${paymentData.orderId}</p>
                    <p><strong>Estado:</strong> Pagado ✓</p>
                    <p><strong>Monto:</strong> $${paymentData.amount || '0.00'}</p>
                    <p><strong>Fecha:</strong> ${new Date().toLocaleDateString()}</p>
                </div>
                
                <p>Tu orden está siendo procesada y te notificaremos cuando esté en camino.</p>
                <p>¡Gracias por tu compra!</p>
                
                <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #eee; font-size: 12px; color: #666;">
                    <p>Si tienes alguna pregunta, contáctanos en soporte@example.com</p>
                </div>
            </div>
        `,
        orderId: paymentData.orderId
    };

    // Publicar el email a la cola de emails para procesamiento
    try {
        const connection = await amqp.connect(RABBITMQ_URL);
        const emailChannel = await connection.createChannel();
        
        await emailChannel.assertQueue(QUEUE_NAME, { durable: true });
        emailChannel.sendToQueue(QUEUE_NAME, Buffer.from(JSON.stringify(emailData)), {
            persistent: true
        });
        
        await emailChannel.close();
        await connection.close();
        
        console.log(`📧 Email de pago encolado para: ${paymentData.userEmail}`);
    } catch (error) {
        console.error('❌ Error encolando email de pago:', error);
    }
}

// ==================== ENDPOINTS HTTP ====================

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({ 
        status: 'OK', 
        service: 'Notification Service',
        timestamp: new Date().toISOString(),
        queues: [QUEUE_NAME, PAYMENT_QUEUE]
    });
});

// Endpoint para verificar estado de las colas
app.get('/queue-status', async (req, res) => {
    let connection;
    try {
        connection = await amqp.connect(RABBITMQ_URL);
        const channel = await connection.createChannel();
        
        const emailQueue = await channel.assertQueue(QUEUE_NAME, { durable: true });
        const paymentQueue = await channel.assertQueue(PAYMENT_QUEUE, { durable: true });
        
        await channel.close();
        await connection.close();

        res.json({
            queues: {
                [QUEUE_NAME]: {
                    messageCount: emailQueue.messageCount,
                    consumerCount: emailQueue.consumerCount
                },
                [PAYMENT_QUEUE]: {
                    messageCount: paymentQueue.messageCount,
                    consumerCount: paymentQueue.consumerCount
                }
            },
            status: 'active'
        });
    } catch (error) {
        console.error('Error verificando colas:', error.message);
        res.status(500).json({ 
            error: 'Error verificando estado de las colas',
            details: error.message 
        });
    }
});

// Endpoint para enviar email de prueba
app.post('/test-email', async (req, res) => {
    try {
        const { to, subject, body } = req.body;
        
        const testEmail = {
            to: to || 'test@example.com',
            subject: subject || 'Email de prueba - Notification Service',
            body: body || 'Este es un email de prueba del servicio de notificaciones',
            type: 'TEST'
        };

        // Publicar a la cola de emails
        const connection = await amqp.connect(RABBITMQ_URL);
        const channel = await connection.createChannel();
        
        await channel.assertQueue(QUEUE_NAME, { durable: true });
        channel.sendToQueue(QUEUE_NAME, Buffer.from(JSON.stringify(testEmail)), {
            persistent: true
        });

        await channel.close();
        await connection.close();

        res.json({ 
            message: 'Email de prueba encolado exitosamente',
            email: testEmail
        });
        
    } catch (error) {
        res.status(500).json({ 
            error: 'Error encolando email de prueba',
            details: error.message 
        });
    }
});

// Endpoint para simular pago exitoso (para testing)
app.post('/simulate-payment', async (req, res) => {
    try {
        const { orderId, userEmail, amount } = req.body;
        
        if (!orderId) {
            return res.status(400).json({ error: 'orderId es requerido' });
        }

        console.log(`💳 Simulando pago para orden: ${orderId}`);
        
        const paymentEvent = {
            orderId: orderId,
            userEmail: userEmail || `user${orderId}@example.com`,
            amount: amount || 50.00,
            status: 'paid',
            timestamp: new Date().toISOString()
        };

        // Publicar evento de pago a RabbitMQ
        const connection = await amqp.connect(RABBITMQ_URL);
        const channel = await connection.createChannel();
        
        await channel.assertQueue(PAYMENT_QUEUE, { durable: true });
        channel.sendToQueue(PAYMENT_QUEUE, Buffer.from(JSON.stringify(paymentEvent)), {
            persistent: true
        });

        await channel.close();
        await connection.close();

        res.json({ 
            message: `Evento de pago simulado para orden ${orderId}`,
            event: paymentEvent
        });
        
    } catch (error) {
        res.status(500).json({ 
            error: 'Error simulando pago',
            details: error.message 
        });
    }
});

// ==================== INICIALIZACIÓN ====================

// Iniciar servidor
const server = app.listen(PORT, () => {
    console.log(`📧 Notification Service running on port ${PORT}`);
    console.log(`🔗 RabbitMQ: ${RABBITMQ_URL}`);
    console.log(`📬 Queues: ${QUEUE_NAME}, ${PAYMENT_QUEUE}`);
    
    // Iniciar consumers
    consumeEmails();
    consumePaymentEvents();
});

// Manejo graceful de cierre
process.on('SIGINT', async () => {
    console.log('\n🛑 Cerrando servicio de notificaciones...');
    server.close(() => {
        console.log('✅ Servidor HTTP cerrado');
        process.exit(0);
    });
});

process.on('unhandledRejection', (error) => {
    console.error('⚠️ Unhandled Rejection:', error);
});

process.on('uncaughtException', (error) => {
    console.error('💥 Uncaught Exception:', error);
    process.exit(1);
});