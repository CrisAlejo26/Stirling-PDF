package stirling.software.SPDF.security.service;

import java.util.List;

import org.springframework.boot.autoconfigure.condition.ConditionalOnMissingClass;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.http.HttpStatus;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

import lombok.RequiredArgsConstructor;

import stirling.software.SPDF.security.model.Role;
import stirling.software.SPDF.security.model.User;
import stirling.software.SPDF.security.repository.UserRepository;

@Service
@ConditionalOnMissingClass("stirling.software.proprietary.security.service.UserService")
@RequiredArgsConstructor
public class UserService {

    private final UserRepository userRepository;
    private final PasswordEncoder passwordEncoder;

    public User createUser(
            String name, String username, String loginName, String rawPassword, Role role) {
        if (userRepository.existsByUsername(username)) {
            throw new ResponseStatusException(
                    HttpStatus.CONFLICT, "El email ya está en uso: " + username);
        }
        if (loginName != null
                && !loginName.isBlank()
                && userRepository.existsByLoginName(loginName)) {
            throw new ResponseStatusException(
                    HttpStatus.CONFLICT, "El nombre de usuario ya existe: " + loginName);
        }
        User user =
                User.builder()
                        .name(name)
                        .username(username)
                        .loginName(loginName != null && !loginName.isBlank() ? loginName : null)
                        .password(passwordEncoder.encode(rawPassword))
                        .role(role)
                        .enabled(true)
                        .build();
        return userRepository.save(user);
    }

    public User updateUser(String id, String name, String loginName, Role role, boolean enabled) {
        User user = findById(id);
        if (user.getRole() == Role.ADMIN
                && role != Role.ADMIN
                && userRepository.countByRole(Role.ADMIN) <= 1) {
            throw new ResponseStatusException(
                    HttpStatus.CONFLICT, "No se puede degradar al único administrador.");
        }
        // Verificar unicidad de loginName si cambió
        String newLoginName = (loginName != null && !loginName.isBlank()) ? loginName : null;
        if (newLoginName != null
                && !newLoginName.equals(user.getLoginName())
                && userRepository.existsByLoginName(newLoginName)) {
            throw new ResponseStatusException(
                    HttpStatus.CONFLICT, "El nombre de usuario ya existe: " + newLoginName);
        }
        user.setName(name);
        user.setLoginName(newLoginName);
        user.setRole(role);
        user.setEnabled(enabled);
        return userRepository.save(user);
    }

    public void changePassword(String id, String newRawPassword) {
        User user = findById(id);
        user.setPassword(passwordEncoder.encode(newRawPassword));
        userRepository.save(user);
    }

    public void deleteUser(String id) {
        User user = findById(id);
        if (user.getRole() == Role.ADMIN && userRepository.countByRole(Role.ADMIN) <= 1) {
            throw new ResponseStatusException(
                    HttpStatus.CONFLICT, "No se puede eliminar el único administrador.");
        }
        userRepository.delete(user);
    }

    public List<User> findAll() {
        return userRepository.findAll();
    }

    public Page<User> findPaged(int page, int size, String search) {
        PageRequest pageable = PageRequest.of(page, size, Sort.by("name").ascending());
        return userRepository.findBySearch(search == null ? "" : search, pageable);
    }

    public User findById(String id) {
        return userRepository
                .findById(id)
                .orElseThrow(
                        () ->
                                new ResponseStatusException(
                                        HttpStatus.NOT_FOUND, "Usuario no encontrado: " + id));
    }
}
