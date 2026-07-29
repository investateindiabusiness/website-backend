const swaggerUi = require('swagger-ui-express');
const swaggerJsdoc = require('swagger-jsdoc');

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Investate India - Enterprise API Documentation',
      version: '1.0.0',
      description: 'Centralized Swagger UI documenting all endpoints: Authentication, Projects, Builders, Investors, Helpdesk, Notifications, Advertisements, Payments, and general CRM leads.',
      contact: {
        name: 'API Support',
        email: 'support@investateindia.com'
      }
    },
    servers: [
      {
        url: `http://localhost:${process.env.PORT || 5001}`,
        description: 'Local development server'
      }
    ],
    components: {
      securitySchemes: {
        BearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'Input your Firebase ID Token (omit the "Bearer " prefix)'
        }
      }
    },
    security: [
      {
        BearerAuth: []
      }
    ],
    paths: {
      // ==========================================
      // AUTHENTICATION MODULE
      // ==========================================
      '/api/auth/register-step1': {
        post: {
          tags: ['Authentication'],
          summary: 'Step 1: Create email & password credentials',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['email', 'password', 'role'],
                  properties: {
                    email: { type: 'string', example: 'user@example.com' },
                    password: { type: 'string', example: 'password123' },
                    role: { type: 'string', enum: ['investor', 'builder', 'serviceProvider'], example: 'builder' }
                  }
                }
              }
            }
          },
          responses: {
            201: { description: 'User account created. Proceed to submit profile details.' },
            400: { description: 'Invalid payload / validation error' }
          }
        }
      },
      '/api/auth/login': {
        post: {
          tags: ['Authentication'],
          summary: 'User Login',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['email', 'password'],
                  properties: {
                    email: { type: 'string', example: 'user@example.com' },
                    password: { type: 'string', example: 'password123' }
                  }
                }
              }
            }
          },
          responses: {
            200: { description: 'JWT token returned' },
            401: { description: 'Invalid login credentials' }
          }
        }
      },
      '/api/auth/admin-login': {
        post: {
          tags: ['Authentication'],
          summary: 'Admin Portal Login',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['email', 'password'],
                  properties: {
                    email: { type: 'string', example: 'admin@investateindia.com' },
                    password: { type: 'string', example: 'adminpassword' }
                  }
                }
              }
            }
          },
          responses: {
            200: { description: 'Admin token returned' },
            403: { description: 'Access Denied: Insufficient permissions' }
          }
        }
      },
      '/api/auth/builder-form1/{uid}': {
        post: {
          tags: ['Authentication'],
          summary: 'Submit Builder Profile Form 1 (Company Details)',
          parameters: [
            { name: 'uid', in: 'path', required: true, schema: { type: 'string' } }
          ],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    companyName: { type: 'string', example: 'Elite Builders Ltd' },
                    cin: { type: 'string', example: 'U45201DL2005PLC134882' },
                    gst: { type: 'string', example: '07AAAAA1111A1Z1' },
                    phone: { type: 'string', example: '9999999999' }
                  }
                }
              }
            }
          },
          responses: {
            200: { description: 'Form 1 saved. Pending admin review.' }
          }
        }
      },

      // ==========================================
      // PROJECTS MODULE
      // ==========================================
      '/api/projects': {
        get: {
          tags: ['Projects'],
          summary: 'Get all projects',
          responses: {
            200: { description: 'List of real estate projects' }
          }
        },
        post: {
          tags: ['Projects'],
          summary: 'Create a new project (Builder/Admin)',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['title', 'description', 'location', 'minInvestment'],
                  properties: {
                    title: { type: 'string', example: 'Commercial Hub Sector 62' },
                    description: { type: 'string', example: 'Premium grade A office spaces.' },
                    location: { type: 'string', example: 'Noida, UP' },
                    minInvestment: { type: 'number', example: 50000 }
                  }
                }
              }
            }
          },
          responses: {
            210: { description: 'Project created' }
          }
        }
      },
      '/api/projects/{id}': {
        get: {
          tags: ['Projects'],
          summary: 'Get single project detail',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: {
            200: { description: 'Project details' },
            404: { description: 'Project not found' }
          }
        }
      },

      // ==========================================
      // BUILDERS & INVESTORS MODULES
      // ==========================================
      '/api/builders': {
        get: {
          tags: ['Builders'],
          summary: 'List verified Builders',
          responses: { 200: { description: 'List of verified builders' } }
        }
      },
      '/api/builders/{id}': {
        get: {
          tags: ['Builders'],
          summary: 'Get Builder Details',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { 200: { description: 'Builder record' } }
        }
      },
      '/api/investors': {
        get: {
          tags: ['Investors'],
          summary: 'List Investors',
          responses: { 200: { description: 'List of investors' } }
        }
      },

      // ==========================================
      // ADVERTISEMENT SLOTS MODULE
      // ==========================================
      '/api/advertisements/zones': {
        get: {
          tags: ['Advertisements'],
          summary: 'List active advertising placement zones',
          responses: { 200: { description: 'List of placement zones' } }
        }
      },
      '/api/advertisements/zones/{zoneId}/available-slots': {
        get: {
          tags: ['Advertisements'],
          summary: 'Fetch available booking slots for a zone',
          parameters: [
            { name: 'zoneId', in: 'path', required: true, schema: { type: 'string' }, example: 'zone1' }
          ],
          responses: { 200: { description: 'Available slot intervals' } }
        }
      },
      '/api/advertisements/bookings': {
        get: {
          tags: ['Advertisements'],
          summary: 'Retrieve campaign bookings for the authenticated user',
          responses: { 200: { description: 'List of user bookings' } }
        },
        post: {
          tags: ['Advertisements'],
          summary: 'Reserve slot & create Stripe Payment Intent',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['zoneId', 'slotId', 'adContent'],
                  properties: {
                    zoneId: { type: 'string', example: 'zone1' },
                    slotId: { type: 'string', example: 'slot_doc_id' },
                    adContent: {
                      type: 'object',
                      required: ['text'],
                      properties: {
                        imageUrl: { type: 'string', example: 'https://example.com/banner.jpg' },
                        text: { type: 'string', example: 'Invest today!' },
                        targetUrl: { type: 'string', example: 'https://mysite.com' }
                      }
                    }
                  }
                }
              }
            }
          },
          responses: {
            201: { description: 'Slot reserved. Return clientSecret to complete payment.' }
          }
        }
      },

      // ==========================================
      // HELPDESK TICKETING MODULE
      // ==========================================
      '/api/helpdesk/categories': {
        get: {
          tags: ['Helpdesk Support'],
          summary: 'List ticket categories and SLAs',
          responses: { 200: { description: 'Ticket categories list' } }
        }
      },
      '/api/helpdesk/tickets': {
        get: {
          tags: ['Helpdesk Support'],
          summary: 'List tickets for the current authenticated user',
          responses: { 200: { description: 'User support tickets' } }
        },
        post: {
          tags: ['Helpdesk Support'],
          summary: 'Create a support ticket',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['title', 'categoryId', 'description'],
                  properties: {
                    title: { type: 'string', example: 'Login Issue' },
                    categoryId: { type: 'string', example: 'cat_technical_issues' },
                    description: { type: 'string', example: 'Getting 401 when logging in.' }
                  }
                }
              }
            }
          },
          responses: {
            201: { description: 'Support ticket created successfully' }
          }
        }
      },
      '/api/helpdesk/tickets/{id}': {
        get: {
          tags: ['Helpdesk Support'],
          summary: 'Get support ticket details',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { 200: { description: 'Ticket description and messages' } }
        }
      },
      '/api/helpdesk/tickets/{ticketId}/messages': {
        post: {
          tags: ['Helpdesk Support'],
          summary: 'Post a response/message to a ticket',
          parameters: [{ name: 'ticketId', in: 'path', required: true, schema: { type: 'string' } }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['message'],
                  properties: {
                    message: { type: 'string', example: 'Please find attached the screenshot.' }
                  }
                }
              }
            }
          },
          responses: {
            201: { description: 'Message appended' }
          }
        }
      },

      // ==========================================
      // GENERAL CRM / LEADS MODULES
      // ==========================================
      '/api/leads': {
        post: {
          tags: ['Leads & CRM'],
          summary: 'Submit a business lead',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['fullName', 'email', 'phone'],
                  properties: {
                    fullName: { type: 'string', example: 'John Doe' },
                    email: { type: 'string', example: 'johndoe@gmail.com' },
                    phone: { type: 'string', example: '9876543210' }
                  }
                }
              }
            }
          },
          responses: {
            201: { description: 'Lead submitted' }
          }
        }
      },
      '/api/inquiries': {
        post: {
          tags: ['Leads & CRM'],
          summary: 'Submit a general question / enquiry',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['name', 'email', 'message'],
                  properties: {
                    name: { type: 'string', example: 'Alice Cooper' },
                    email: { type: 'string', example: 'alice@example.com' },
                    message: { type: 'string', example: 'I want to invest in Sector 62 Noida project.' }
                  }
                }
              }
            }
          },
          responses: {
            201: { description: 'Inquiry saved' }
          }
        }
      },
      '/api/newsletter/subscribe': {
        post: {
          tags: ['Leads & CRM'],
          summary: 'Subscribe email to Newsletter updates',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['email'],
                  properties: {
                    email: { type: 'string', example: 'subscriber@gmail.com' }
                  }
                }
              }
            }
          },
          responses: {
            200: { description: 'Subscription complete' }
          }
        }
      },

      // ==========================================
      // NOTIFICATIONS MODULE
      // ==========================================
      '/api/notifications': {
        get: {
          tags: ['Notifications'],
          summary: 'Get notifications for current user (regular users see own, admins see all)',
          responses: { 200: { description: 'List of alerts' } }
        }
      },
      '/api/notifications/unread-count': {
        get: {
          tags: ['Notifications'],
          summary: 'Get unread notification count (users: own count, admins: total system count)',
          responses: { 200: { description: 'Unread count' } }
        }
      },
      '/api/notifications/admin/all': {
        get: {
          tags: ['Notifications', 'Admin Only'],
          summary: 'Get ALL notifications in system (Admin/Agent only)',
          parameters: [
            { name: 'limit', in: 'query', schema: { type: 'number' } },
            { name: 'lastDocId', in: 'query', schema: { type: 'string' } },
            { name: 'isRead', in: 'query', schema: { type: 'string', enum: ['true', 'false', 'all'] } },
            { name: 'userId', in: 'query', schema: { type: 'string' } }
          ],
          responses: { 200: { description: 'All notifications list' } }
        }
      },
      '/api/notifications/admin/stats': {
        get: {
          tags: ['Notifications', 'Admin Only'],
          summary: 'Get notification statistics (Admin/Agent only)',
          responses: { 200: { description: 'Notification stats' } }
        }
      },
      '/api/notifications/{id}/read': {
        patch: {
          tags: ['Notifications'],
          summary: 'Mark an alert as read',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { 200: { description: 'Notification read state toggled' } }
        }
      },
      '/api/notifications/read-all': {
        patch: {
          tags: ['Notifications'],
          summary: 'Mark all notifications as read for current user',
          responses: { 200: { description: 'All notifications marked as read' } }
        }
      }
    }
  },
  apis: ['./src/routes/*.js'] // Keeps scanning code-level JSDocs like payments
};

const swaggerSpec = swaggerJsdoc(options);

const setupSwagger = (app) => {
  // Mount the interactive Swagger UI
  app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

  // Expose raw spec JSON
  app.get('/api/docs.json', (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.send(swaggerSpec);
  });

  console.log(`[Swagger] Docs initialized. Available at http://localhost:${process.env.PORT || 5001}/api/docs`);
};

module.exports = setupSwagger;
