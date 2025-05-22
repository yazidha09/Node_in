const express = require('express');
const { engine } = require('express-handlebars');
const bodyParser = require('body-parser');
const mysql = require('mysql2');
const { check, validationResult } = require('express-validator');
const path = require('path');
const multer = require('multer');
const fs = require('fs');

// Configuration de multer pour l'upload des images
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, path.join(__dirname, 'public', 'uploads', 'logos'));
  },
  filename: (req, file, cb) => {
    // Garder l'extension d'origine mais changer le nom pour éviter les conflits
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname);
    cb(null, uniqueSuffix + ext);
  }
});

const upload = multer({ 
  storage: storage,
  limits: { fileSize: 2 * 1024 * 1024 }, // Limite à 2MB
  fileFilter: (req, file, cb) => {
    // Accepter seulement les images
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Le fichier doit être une image'));
    }
  }
});

const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

// Handlebars setup
app.engine('handlebars', engine({ 
  defaultLayout: 'main',
  helpers: {
    eq: function(v1, v2) {
      return v1 === v2;
    },
    formatDate: function(date) {
      const d = new Date(date);
      return d.toLocaleDateString('fr-FR');
    }
  }
}));
app.set('view engine', 'handlebars');
app.set('views', './views');

// Database connection - d'abord se connecter sans spécifier de base de données
const connection = mysql.createConnection({
  host: 'localhost',
  user: 'root',
  password: ''
});

// Connect to MySQL
connection.connect((err) => {
  if (err) {
    console.error('Erreur de connexion à MySQL:', err);
    return;
  }
  console.log('Connecté à MySQL');
  
  // Créer la base de données si elle n'existe pas
  connection.query('CREATE DATABASE IF NOT EXISTS systeme_stages', (err) => {
    if (err) {
      console.error('Erreur lors de la création de la base de données:', err);
      return;
    }
    console.log('Base de données systeme_stages créée ou déjà existante');
    
    // Se reconnecter avec la base de données sélectionnée
    connection.end();
    
    const db = mysql.createConnection({
      host: 'localhost',
      user: 'root',
      password: '',
      database: 'systeme_stages'
    });
    
    // Reconnexion avec la base sélectionnée
    db.connect((err) => {
      if (err) {
        console.error('Erreur de connexion à la base de données:', err);
        return;
      }
      console.log('Connecté à la base de données systeme_stages');
        // Créer la table stagiaires si elle n'existe pas
      const sqlStagiaires = `CREATE TABLE IF NOT EXISTS stagiaires (
        id INT AUTO_INCREMENT PRIMARY KEY,
        nom VARCHAR(100) NOT NULL,
        prenom VARCHAR(100) NOT NULL,
        email VARCHAR(100) NOT NULL UNIQUE,
        telephone VARCHAR(20) NOT NULL,
        niveauEtudes VARCHAR(50) NOT NULL,
        specialite VARCHAR(100) NOT NULL,
        dateDebut DATE NOT NULL,
        dateFin DATE NOT NULL,
        dateInscription TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )`;
      
      db.query(sqlStagiaires, (err) => {
        if (err) {
          console.error('Erreur lors de la création de la table stagiaires:', err);
          return;
        }
        console.log('Table stagiaires créée ou déjà existante');
        
        // Créer la table entreprises
        const sqlEntreprises = `CREATE TABLE IF NOT EXISTS entreprises (
          id INT AUTO_INCREMENT PRIMARY KEY,
          nom VARCHAR(100) NOT NULL,
          secteur VARCHAR(100) NOT NULL,
          adresse VARCHAR(255) NOT NULL,
          email VARCHAR(100) NOT NULL UNIQUE,
          telephone VARCHAR(20) NOT NULL,
          description TEXT,
          logo VARCHAR(255),
          dateInscription TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`;
        
        db.query(sqlEntreprises, (err) => {
          if (err) {
            console.error('Erreur lors de la création de la table entreprises:', err);
            return;
          }
          console.log('Table entreprises créée ou déjà existante');
          
          // Créer la table demandes_stage
          const sqlDemandes = `CREATE TABLE IF NOT EXISTS demandes_stage (
            id INT AUTO_INCREMENT PRIMARY KEY,
            stagiaire_id INT NOT NULL,
            entreprise_id INT NOT NULL,
            message TEXT NOT NULL,
            statut ENUM('en_attente', 'acceptee', 'refusee') DEFAULT 'en_attente',
            dateDemande TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (stagiaire_id) REFERENCES stagiaires(id) ON DELETE CASCADE,
            FOREIGN KEY (entreprise_id) REFERENCES entreprises(id) ON DELETE CASCADE
          )`;
          
          db.query(sqlDemandes, (err) => {
            if (err) {
              console.error('Erreur lors de la création de la table demandes_stage:', err);
              return;
            }
            console.log('Table demandes_stage créée ou déjà existante');
          });
        });
      });
      
      // Remplacer la référence à db dans le scope global
      global.db = db;
    });
  });
});

// Créer une référence db dans le scope global pour les routes
let db;

// Validation rules
const stagiaireValidationRules = [
  check('nom').notEmpty().withMessage('Le nom est obligatoire').trim().escape(),
  check('prenom').notEmpty().withMessage('Le prénom est obligatoire').trim().escape(),
  check('email').isEmail().withMessage('Adresse email invalide').normalizeEmail(),
  check('telephone').notEmpty().withMessage('Le téléphone est obligatoire')
    .matches(/^[0-9+\s]+$/).withMessage('Format de téléphone invalide'),
  check('niveauEtudes').notEmpty().withMessage('Le niveau d\'études est obligatoire'),
  check('specialite').notEmpty().withMessage('La spécialité est obligatoire'),
  check('dateDebut').isDate().withMessage('Date de début invalide'),
  check('dateFin').isDate().withMessage('Date de fin invalide')
    .custom((value, { req }) => {
      if (new Date(value) <= new Date(req.body.dateDebut)) {
        throw new Error('La date de fin doit être postérieure à la date de début');
      }
      return true;
    })
];

// Routes
app.get('/', (req, res) => {
  res.render('accueil');
});

app.get('/inscription', (req, res) => {
  res.render('inscription');
});

app.post('/inscription', stagiaireValidationRules, (req, res) => {
  const errors = validationResult(req);
  
  if (!errors.isEmpty()) {
    return res.render('inscription', { 
      errors: errors.array(),
      stagiaire: req.body
    });
  }

  const stagiaire = {
    nom: req.body.nom,
    prenom: req.body.prenom,
    email: req.body.email,
    telephone: req.body.telephone,
    niveauEtudes: req.body.niveauEtudes,
    specialite: req.body.specialite,
    dateDebut: req.body.dateDebut,
    dateFin: req.body.dateFin
  };

  global.db.query('INSERT INTO stagiaires SET ?', stagiaire, (err, result) => {
    if (err) {
      if (err.code === 'ER_DUP_ENTRY') {
        return res.render('inscription', { 
          errors: [{ msg: 'Cette adresse email est déjà utilisée' }],
          stagiaire: req.body
        });
      }
      console.error('Erreur lors de l\'enregistrement:', err);
      return res.render('inscription', { 
        errors: [{ msg: 'Erreur lors de l\'enregistrement, veuillez réessayer' }],
        stagiaire: req.body
      });
    }
    
    res.redirect('/liste');
  });
});

app.get('/liste', (req, res) => {
  global.db.query('SELECT * FROM stagiaires ORDER BY dateInscription DESC', (err, stagiaires) => {
    if (err) {
      console.error('Erreur lors de la récupération des stagiaires:', err);
      return res.render('liste', { error: 'Erreur lors de la récupération des stagiaires' });
    }
    
    res.render('liste', { stagiaires });
  });
});

// Route pour exporter la liste des stagiaires en CSV
app.get('/export-csv', (req, res) => {
  global.db.query('SELECT * FROM stagiaires ORDER BY nom ASC', (err, stagiaires) => {
    if (err) {
      console.error('Erreur lors de la récupération des stagiaires:', err);
      return res.status(500).send('Erreur lors de la génération du CSV');
    }
    
    // Définir les en-têtes pour le téléchargement du CSV
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=liste_stagiaires.csv');
    
    // En-tête CSV
    let csv = 'Nom,Prénom,Email,Téléphone,Niveau d\'études,Spécialité,Date de début,Date de fin\n';
    
    // Ajouter les données
    stagiaires.forEach(stagiaire => {
      const dateDebut = new Date(stagiaire.dateDebut).toLocaleDateString('fr-FR');
      const dateFin = new Date(stagiaire.dateFin).toLocaleDateString('fr-FR');
      
      csv += `"${stagiaire.nom}","${stagiaire.prenom}","${stagiaire.email}","${stagiaire.telephone}","${stagiaire.niveauEtudes}","${stagiaire.specialite}","${dateDebut}","${dateFin}"\n`;
    });
    
    res.send(csv);
  });
});

// Validation des entreprises
const entrepriseValidationRules = [
  check('nom').notEmpty().withMessage('Le nom de l\'entreprise est obligatoire').trim().escape(),
  check('secteur').notEmpty().withMessage('Le secteur d\'activité est obligatoire'),
  check('adresse').notEmpty().withMessage('L\'adresse est obligatoire').trim().escape(),
  check('email').isEmail().withMessage('Adresse email invalide').normalizeEmail(),
  check('telephone').notEmpty().withMessage('Le téléphone est obligatoire')
    .matches(/^[0-9+\s]+$/).withMessage('Format de téléphone invalide')
];

// Validation des demandes de stage
const demandeStageValidationRules = [
  check('message').notEmpty().withMessage('Le message de motivation est obligatoire').trim().escape()
];

// Routes pour les entreprises
app.get('/inscription-entreprise', (req, res) => {
  res.render('inscription-entreprise');
});

app.post('/inscription-entreprise', upload.single('logo'), entrepriseValidationRules, (req, res) => {
  const errors = validationResult(req);
  
  if (!errors.isEmpty()) {
    // Si un fichier a été uploadé mais qu'il y a des erreurs de validation, le supprimer
    if (req.file) {
      fs.unlinkSync(req.file.path);
    }
    
    return res.render('inscription-entreprise', { 
      errors: errors.array(),
      entreprise: req.body
    });
  }

  const entreprise = {
    nom: req.body.nom,
    secteur: req.body.secteur,
    adresse: req.body.adresse,
    email: req.body.email,
    telephone: req.body.telephone,
    description: req.body.description || null,
    logo: req.file ? req.file.filename : null
  };

  global.db.query('INSERT INTO entreprises SET ?', entreprise, (err, result) => {
    if (err) {
      // En cas d'erreur, supprimer le fichier uploadé s'il existe
      if (req.file) {
        fs.unlinkSync(req.file.path);
      }
      
      if (err.code === 'ER_DUP_ENTRY') {
        return res.render('inscription-entreprise', { 
          errors: [{ msg: 'Cette adresse email est déjà utilisée' }],
          entreprise: req.body
        });
      }
      console.error('Erreur lors de l\'enregistrement de l\'entreprise:', err);
      return res.render('inscription-entreprise', { 
        errors: [{ msg: 'Erreur lors de l\'enregistrement, veuillez réessayer' }],
        entreprise: req.body
      });
    }
    
    res.redirect('/liste-entreprises');
  });
});

app.get('/liste-entreprises', (req, res) => {
  global.db.query('SELECT * FROM entreprises ORDER BY nom ASC', (err, entreprises) => {
    if (err) {
      console.error('Erreur lors de la récupération des entreprises:', err);
      return res.render('liste-entreprises', { error: 'Erreur lors de la récupération des entreprises' });
    }
    
    res.render('liste-entreprises', { entreprises });
  });
});

app.get('/entreprise/:id', (req, res) => {
  const entrepriseId = req.params.id;
  
  global.db.query('SELECT * FROM entreprises WHERE id = ?', [entrepriseId], (err, results) => {
    if (err) {
      console.error('Erreur lors de la récupération de l\'entreprise:', err);
      return res.render('detail-entreprise', { error: 'Entreprise non trouvée' });
    }
    
    if (results.length === 0) {
      return res.render('detail-entreprise', { error: 'Entreprise non trouvée' });
    }
    
    res.render('detail-entreprise', { entreprise: results[0] });
  });
});

app.get('/demande-stage/:entrepriseId', (req, res) => {
  const entrepriseId = req.params.entrepriseId;
  
  // Dans un système réel, on récupérerait l'ID du stagiaire connecté depuis la session
  // Pour l'exemple, nous allons supposer qu'on le passe en paramètre de requête
  const stagiaireId = req.query.stagiaireId;
  
  global.db.query('SELECT * FROM entreprises WHERE id = ?', [entrepriseId], (err, entrepriseResults) => {
    if (err || entrepriseResults.length === 0) {
      return res.redirect('/liste-entreprises');
    }
    
    const entreprise = entrepriseResults[0];
    
    if (stagiaireId) {
      global.db.query('SELECT * FROM stagiaires WHERE id = ?', [stagiaireId], (err, stagiaireResults) => {
        if (err || stagiaireResults.length === 0) {
          return res.render('demande-stage', { 
            entreprise,
            error: 'Stagiaire non trouvé. Veuillez vous inscrire avant de faire une demande de stage.'
          });
        }
        
        res.render('demande-stage', { 
          entreprise,
          stagiaire: stagiaireResults[0]
        });
      });
    } else {
      res.render('demande-stage', { entreprise });
    }
  });
});

app.post('/demande-stage/:entrepriseId', demandeStageValidationRules, (req, res) => {
  const errors = validationResult(req);
  const entrepriseId = req.params.entrepriseId;
  const stagiaireId = req.body.stagiaire_id;
  
  if (!errors.isEmpty()) {
    global.db.query('SELECT * FROM entreprises WHERE id = ?', [entrepriseId], (err, entrepriseResults) => {
      if (err || entrepriseResults.length === 0) {
        return res.redirect('/liste-entreprises');
      }
      
      global.db.query('SELECT * FROM stagiaires WHERE id = ?', [stagiaireId], (err, stagiaireResults) => {
        if (err || stagiaireResults.length === 0) {
          return res.render('demande-stage', { 
            entreprise: entrepriseResults[0],
            errors: errors.array(),
            demande: req.body
          });
        }
        
        return res.render('demande-stage', { 
          entreprise: entrepriseResults[0],
          stagiaire: stagiaireResults[0],
          errors: errors.array(),
          demande: req.body
        });
      });
    });
    return;
  }

  const demande = {
    stagiaire_id: stagiaireId,
    entreprise_id: entrepriseId,
    message: req.body.message
  };

  global.db.query('INSERT INTO demandes_stage SET ?', demande, (err, result) => {
    if (err) {
      console.error('Erreur lors de l\'enregistrement de la demande:', err);
      global.db.query('SELECT * FROM entreprises WHERE id = ?', [entrepriseId], (err, entrepriseResults) => {
        if (err || entrepriseResults.length === 0) {
          return res.redirect('/liste-entreprises');
        }
        
        global.db.query('SELECT * FROM stagiaires WHERE id = ?', [stagiaireId], (err, stagiaireResults) => {
          return res.render('demande-stage', { 
            entreprise: entrepriseResults[0],
            stagiaire: stagiaireResults[0],
            errors: [{ msg: 'Erreur lors de l\'enregistrement de la demande. Veuillez réessayer.' }],
            demande: req.body
          });
        });
      });
      return;
    }
    
    // Rediriger vers la page des demandes du stagiaire avec un message de succès
    res.redirect(`/mes-demandes?success=Votre demande a été envoyée avec succès`);
  });
});

app.get('/mes-demandes', (req, res) => {
  // Dans un système réel, on récupérerait l'ID du stagiaire connecté depuis la session
  // Pour l'exemple, nous allons supposer qu'on le passe en paramètre de requête
  const stagiaireId = req.query.stagiaireId;
  
  if (!stagiaireId) {
    return res.render('mes-demandes', { 
      error: 'Veuillez vous connecter pour voir vos demandes de stage'
    });
  }
  
  const query = `
    SELECT ds.*, e.nom, e.secteur, e.logo
    FROM demandes_stage ds
    JOIN entreprises e ON ds.entreprise_id = e.id
    WHERE ds.stagiaire_id = ?
    ORDER BY ds.dateDemande DESC
  `;
  
  global.db.query(query, [stagiaireId], (err, results) => {
    if (err) {
      console.error('Erreur lors de la récupération des demandes:', err);
      return res.render('mes-demandes', { 
        error: 'Erreur lors de la récupération des demandes'
      });
    }
    
    // Transformer les résultats pour avoir un format plus facile à utiliser dans le template
    const demandes = results.map(row => ({
      id: row.id,
      statut: row.statut,
      dateDemande: row.dateDemande,
      message: row.message,
      entreprise: {
        id: row.entreprise_id,
        nom: row.nom,
        secteur: row.secteur,
        logo: row.logo
      }
    }));
    
    res.render('mes-demandes', { 
      demandes,
      success: req.query.success
    });
  });
});

// Start server
app.listen(port, () => {
  console.log(`Serveur démarré sur le port ${port}`);
});
