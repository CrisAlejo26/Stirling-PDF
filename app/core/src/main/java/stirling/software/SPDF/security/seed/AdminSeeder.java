package stirling.software.SPDF.security.seed;

import org.springframework.boot.autoconfigure.condition.ConditionalOnMissingClass;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.ApplicationListener;
import org.springframework.stereotype.Component;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;

import stirling.software.SPDF.security.model.Role;
import stirling.software.SPDF.security.repository.UserRepository;
import stirling.software.SPDF.security.service.UserService;

@Slf4j
@Component
@RequiredArgsConstructor
@ConditionalOnMissingClass(
        "stirling.software.proprietary.security.configuration.SecurityConfiguration")
public class AdminSeeder implements ApplicationListener<ApplicationReadyEvent> {

    private final UserRepository userRepository;
    private final UserService userService;

    @Override
    public void onApplicationEvent(ApplicationReadyEvent event) {
        if (userRepository.existsByRole(Role.ADMIN)) {
            return;
        }

        String username = System.getenv().getOrDefault("ADMIN_USERNAME", "admin@stirling.local");
        String password = System.getenv().getOrDefault("ADMIN_PASSWORD", "ChangeMe123!");

        userService.createUser("Super Admin", username, null, password, Role.ADMIN);

        log.warn("════════════════════════════════════════════════════════════");
        log.warn("  SUPERADMIN CREADO — CAMBIA LA CONTRASEÑA DESPUÉS DE LOGIN");
        log.warn("  Usuario:     {}", username);
        log.warn("  Contraseña:  {}", password);
        log.warn("════════════════════════════════════════════════════════════");
    }
}
