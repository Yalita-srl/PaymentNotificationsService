const amqp = require('amqplib');
const nodemailer = require('nodemailer');
const express = require('express');
const axios = require('axios');
require('dotenv').config();

const app = express();
app.use(express.json());

// Configuración desde variables de entorno
const QUEUE_NAME = process.env.EMAILS_QUEUE || 'emails_queue';
const PAYMENT_QUEUE = process.env.PAYMENT_QUEUE || 'payment_events';
const ORDER_QUEUE = process.env.ORDER_QUEUE || 'order_events';
const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://guest:guest@127.0.0.1:5672';
const ORDERS_SERVICE_URL = process.env.ORDERS_SERVICE_URL || 'http://localhost:3000';
const JWT_TOKEN = process.env.JWT_TOKEN;
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

async function sendOrderConfirmationEmail(emailData) {
    const mailOptions = {
        from: process.env.EMAIL_FROM || 'Notificaciones <noreply@example.com>',
        to: emailData.to,
        subject: emailData.subject,
        html: emailData.body,
        text: emailData.body.replace(/<[^>]*>/g, ''),
        attachments: emailData.attachments || []
    };

    try {
        const info = await transporter.sendMail(mailOptions);
        console.log(`✅ Correo enviado a: ${emailData.to} - Message ID: ${info.messageId}`);
        return { success: true, messageId: info.messageId };
    } catch (error) {
        console.error(`❌ Error enviando correo a ${emailData.to}:`, error);
        return { success: false, error: error.message };
    }
}

async function sendWelcomeEmail(emailData) {
    const mailOptions = {
        from: process.env.EMAIL_FROM || 'Bienvenida <noreply@example.com>',
        to: emailData.to,
        subject: emailData.subject,
        html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                <h1 style="color: #333;">¡Bienvenido/a!</h1>
                <p>Gracias por registrarte en nuestro servicio.</p>
                <p>${emailData.body}</p>
                <div style="background-color: #f5f5f5; padding: 15px; margin: 20px 0;">
                    <p style="margin: 0;">Estamos emocionados de tenerte con nosotros.</p>
                </div>
            </div>
        `,
        text: `¡Bienvenido/a! Gracias por registrarte. ${emailData.body}`
    };

    try {
        const info = await transporter.sendMail(mailOptions);
        console.log(`✅ Email de bienvenida enviado a: ${emailData.to}`);
        return { success: true, messageId: info.messageId };
    } catch (error) {
        console.error(`❌ Error enviando email de bienvenida:`, error);
        return { success: false, error: error.message };
    }
}

async function sendPaymentConfirmationEmail(emailData) {
    const mailOptions = {
        from: process.env.EMAIL_FROM || 'Pagos <noreply@example.com>',
        to: emailData.to,
        subject: emailData.subject,
        html: emailData.body,
        text: emailData.body.replace(/<[^>]*>/g, '')
    };

    try {
        const info = await transporter.sendMail(mailOptions);
        console.log(`✅ Email de pago enviado a: ${emailData.to}`);
        return { success: true, messageId: info.messageId };
    } catch (error) {
        console.error(`❌ Error enviando email de pago:`, error);
        return { success: false, error: error.message };
    }
}

// ==================== PROCESAMIENTO DE EMAILS ====================

async function processEmailFromQueue(emailData) {
    console.log(`📧 Procesando email para: ${emailData.to}`);
    console.log(`📝 Tipo: ${emailData.type || 'General'}`);

    let result;
    
    switch (emailData.type) {
        case 'ORDER_CONFIRMATION':
            result = await sendOrderConfirmationEmail(emailData);
            break;
        case 'WELCOME_EMAIL':
            result = await sendWelcomeEmail(emailData);
            break;
        case 'PAYMENT_CONFIRMATION':
            result = await sendPaymentConfirmationEmail(emailData);
            break;
        default:
            result = await sendOrderConfirmationEmail(emailData);
            break;
    }

    return result;
}

// ==================== INTEGRACIÓN CON ORDERS SERVICE ====================
async function updateOrderStatus(orderId, newStatus) {
  try {
    const url = `${ORDERS_SERVICE_URL}/api/v1/orders/${orderId}/state/${newStatus}`;
    
    console.log(`🔄 Cambiando estado de orden ${orderId} a ${newStatus}`);
    console.log(`🔑 Usando JWT Token: ${JWT_TOKEN.substring(0, 20)}...`);
    
    const response = await axios.put(url, {}, {
      headers: {
        'Authorization': `Bearer ${JWT_TOKEN}`,
        'Content-Type': 'application/json'
      }
    });

    console.log(`✅ Estado de orden ${orderId} cambiado exitosamente a ${newStatus}`);
    return { success: true, data: response.data };
    
  } catch (error) {
    console.error(`❌ Error cambiando estado de orden ${orderId}:`, error.response?.data || error.message);
    
    // Debug adicional
    if (error.response?.status === 401) {
      console.log('🔐 Error 401 - Token inválido o expirado');
      console.log('💡 Sugerencia: Genera un nuevo token desde el servicio de usuarios');
    }
    
    return { 
      success: false, 
      error: error.response?.data || error.message 
    };
  }
}

function generatePaymentEmailBody(orderId, status, amount) {
    const statusMessages = {
        'paid': 'ha sido confirmado exitosamente',
        'failed': 'ha fallado',
        'refunded': 'ha sido reembolsado'
    };

    return `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h1 style="color: #333;">${status === 'paid' ? '¡Pago Confirmado!' : 'Problema con tu pago'}</h1>
            <p>El pago para tu orden #${orderId} ${statusMessages[status] || 'ha cambiado de estado'}.</p>
            
            <div style="background-color: #f5f5f5; padding: 15px; margin: 20px 0;">
                <h3 style="margin-top: 0;">Detalles del pago:</h3>
                <p><strong>Número de orden:</strong> #${orderId}</p>
                <p><strong>Estado:</strong> ${status}</p>
                ${amount ? `<p><strong>Monto:</strong> $${amount}</p>` : ''}
                <p><strong>Fecha:</strong> ${new Date().toLocaleDateString()}</p>
            </div>
            
            <p>Si tienes alguna pregunta, no dudes en contactarnos.</p>
        </div>
    `;
}

// ==================== CONSUMERS RABBITMQ ====================

// Consumer para emails
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
            if (msg !== null) {
                try {
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

        return { connection, channel };

    } catch (error) {
        console.error('💥 Error en el consumidor de emails:', error.message);
        setTimeout(consumeEmails, 5000);
    }
}

// Consumer para eventos de pago - USANDO EMAIL DEL TOKEN
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
      if (msg !== null) {
        try {
          const paymentEvent = JSON.parse(msg.content.toString());
          console.log(`💰 Evento de pago recibido:`, paymentEvent);
          
          // PRIMERO: Actualizar estado en el servicio de órdenes
          const updateResult = await updateOrderStatus(paymentEvent.orderId, 'paid');
          
          // SOLO SI se actualizó el estado, enviar email
          if (updateResult.success) {
            console.log(`✅ Estado actualizado, enviando email...`);
            
            // OBTENER EL EMAIL DEL TOKEN JWT
            const userEmail = getEmailFromToken(JWT_TOKEN);
            
            if (!userEmail) {
              console.error('❌ No se pudo obtener el email del token, no se enviará correo');
              channel.ack(msg);
              return;
            }
            
            // Enviar email de confirmación
            const emailData = {
              type: 'PAYMENT_CONFIRMATION',
              to: userEmail,
              subject: `✅ Pago confirmado - Orden #${paymentEvent.orderId}`,
              body: `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                  <h1 style="color: #333;">¡Pago Confirmado Exitosamente!</h1>
                  <p>Hola,</p>
                  <p>Tu pago para la <strong>Orden #${paymentEvent.orderId}</strong> ha sido procesado correctamente.</p>
                  
                  <div style="background-color: #f5f5f5; padding: 15px; margin: 20px 0; border-radius: 5px;">
                    <h3 style="margin-top: 0; color: #2c5aa0;">Resumen de tu compra:</h3>
                    <p><strong>Número de orden:</strong> #${paymentEvent.orderId}</p>
                    <p><strong>Estado:</strong> Pagado ✓</p>
                    <p><strong>Monto:</strong> $${paymentEvent.amount || '0.00'}</p>
                    <p><strong>Fecha:</strong> ${new Date().toLocaleDateString()}</p>
                  </div>
                  
                  <p>Tu orden está siendo procesada y te notificaremos cuando esté en camino.</p>
                  <p>¡Gracias por tu compra!</p>
                  
                  <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #eee; font-size: 12px; color: #666;">
                    <p>Si tienes alguna pregunta, contáctanos en soporte@example.com</p>
                  </div>
                </div>
              `,
              orderId: paymentEvent.orderId
            };
            
            const emailResult = await processEmailFromQueue(emailData);
            if (emailResult.success) {
              console.log(`📧 Email de confirmación enviado a: ${userEmail}`);
            } else {
              console.error(`❌ Error enviando email: ${emailResult.error}`);
            }
            
          } else {
            console.error(`❌ No se envió email porque falló la actualización del estado: ${updateResult.error}`);
          }
          
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
        const { to, subject, body, type } = req.body;
        
        const testEmail = {
            to: to || 'test@example.com',
            subject: subject || 'Email de prueba - Notification Service',
            body: body || 'Este es un email de prueba del servicio de notificaciones',
            type: type || 'TEST'
        };

        const result = await processEmailFromQueue(testEmail);
        
        if (result.success) {
            res.json({ 
                message: 'Email de prueba enviado exitosamente',
                messageId: result.messageId 
            });
        } else {
            res.status(500).json({ 
                error: 'Error enviando email de prueba',
                details: result.error 
            });
        }
    } catch (error) {
        res.status(500).json({ 
            error: 'Error procesando solicitud de prueba',
            details: error.message 
        });
    }
});

// Endpoint para simular pago exitoso
app.post('/simulate-payment', async (req, res) => {
    try {
        const { orderId, userEmail, amount, status } = req.body;
        
        if (!orderId) {
            return res.status(400).json({ error: 'orderId es requerido' });
        }

        console.log(`💳 Simulando pago para orden: ${orderId}`);
        
        // Publicar evento de pago a RabbitMQ
        const connection = await amqp.connect(RABBITMQ_URL);
        const channel = await connection.createChannel();
        
        const paymentEvent = {
            orderId: orderId,
            userEmail: userEmail || `user${orderId}@example.com`,
            amount: amount || 50.00,
            status: status || 'completed',
            timestamp: new Date().toISOString()
        };

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
    console.log(`🔗 Orders Service: ${ORDERS_SERVICE_URL}`);
    
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

// Función para obtener el email del usuario desde el servicio de órdenes
async function getUserEmail(orderId) {
  try {
    const url = `${ORDERS_SERVICE_URL}/api/v1/orders/${orderId}`;
    
    console.log(`📧 Obteniendo email para orden ${orderId}`);
    
    const response = await axios.get(url, {
      headers: {
        'Authorization': `Bearer ${JWT_TOKEN}`,
        'Content-Type': 'application/json'
      }
    });

    const order = response.data;
    
    // Si la orden tiene userEmail, usarlo directamente
    if (order.userEmail) {
      console.log(`✅ Email obtenido de la orden: ${order.userEmail}`);
      return order.userEmail;
    }
    
    // Si no, intentar obtener del usuario (necesitarías un servicio de usuarios)
    console.log('⚠️  No se encontró email en la orden, usando email por defecto');
    return 'cliente@example.com';
    
  } catch (error) {
    console.error(`❌ Error obteniendo email para orden ${orderId}:`, error.response?.data || error.message);
    return 'cliente@example.com';
  }
}

// Función para extraer email del token JWT
function getEmailFromToken(token) {
  try {
    if (!token) {
      console.log('❌ No hay token disponible');
      return null;
    }
    
    // Decodificar el payload del token JWT (sin verificar firma)
    const payloadBase64 = token.split('.')[1];
    const payloadJson = Buffer.from(payloadBase64, 'base64').toString();
    const payload = JSON.parse(payloadJson);
    
    console.log('🔍 Payload del token:', payload);
    
    // Buscar el email en diferentes posibles campos
    const email = payload.email || payload.userEmail || payload.sub || payload.username;
    
    if (email) {
      console.log(`✅ Email obtenido del token: ${email}`);
      return email;
    } else {
      console.log('❌ No se encontró email en el token');
      return null;
    }
    
  } catch (error) {
    console.error('💥 Error decodificando token:', error.message);
    return null;
  }
}